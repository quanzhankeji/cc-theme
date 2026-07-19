import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);

function processRecord(value) {
  return value && Number.isSafeInteger(value.pid) && value.pid > 1 &&
    Number.isSafeInteger(value.ppid) && value.ppid >= 0;
}

export function selectSingleNewProcess(beforePids, currentProcesses) {
  const before = new Set((beforePids ?? []).map(Number));
  const current = (currentProcesses ?? []).filter(processRecord);
  const added = current.filter(({ pid }) => !before.has(pid));
  if (added.length === 0) return { status: "pending" };
  if (added.length !== 1 || current.length !== 1) {
    return { status: "conflict", code: "multiple-codex-main-processes" };
  }
  return { status: "ready", process: added[0] };
}

export function listenerTreeOwned(rootPid, listenerPids, processes) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1 || !Array.isArray(listenerPids) || !listenerPids.length) return false;
  const parents = new Map((processes ?? []).filter(processRecord).map(({ pid, ppid }) => [pid, ppid]));
  const belongs = (candidate) => {
    let pid = Number(candidate);
    const seen = new Set();
    for (let depth = 0; depth < 64 && pid > 1 && !seen.has(pid); depth += 1) {
      if (pid === rootPid) return true;
      seen.add(pid);
      pid = parents.get(pid);
      if (!Number.isSafeInteger(pid)) return false;
    }
    return false;
  };
  return listenerPids.every(belongs);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function waitForNewTrustedProcess({
  beforePids,
  listProcesses,
  timeoutMs,
  pollMs = 100,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = Date.now,
}) {
  if (typeof listProcesses !== "function" || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("A bounded process probe is required");
  }
  const deadline = now() + timeoutMs;
  do {
    const selected = selectSingleNewProcess(beforePids, await listProcesses());
    if (selected.status === "ready") return selected.process;
    if (selected.status === "conflict") throw codedError(selected.code, "Codex launch created an ambiguous process set");
    if (now() >= deadline) break;
    await sleep(pollMs);
  } while (true);
  throw codedError("launch-process-timeout", "Codex launch process did not become visible before the deadline");
}

function exactCommand(command, executable) {
  return command === executable || command.startsWith(`${executable} `);
}

async function processTable() {
  const { stdout } = await execFile("/bin/ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }];
  });
}

async function startedAt(pid) {
  const { stdout } = await execFile("/bin/ps", ["-p", String(pid), "-o", "lstart="], { maxBuffer: 4096 });
  return stdout.trim().replace(/\s+/g, " ");
}

async function listCodexProcesses(executable) {
  const rows = (await processTable()).filter(({ command }) => exactCommand(command, executable));
  return Promise.all(rows.map(async ({ pid, ppid }) => ({ pid, ppid, startedAt: await startedAt(pid) })));
}

async function listenerPids(port) {
  try {
    const { stdout } = await execFile("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { maxBuffer: 64 * 1024 });
    return [...new Set(stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger))];
  } catch (error) {
    if (error?.code === 1) return [];
    throw error;
  }
}

async function cdpReady(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function option(args, name, required = true) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  if (required && (!value || value.startsWith("--"))) throw codedError("invalid-argument", `Missing ${name}`);
  return value;
}

async function main(args) {
  const [operation] = args;
  const executable = option(args, "--exe");
  if (!executable.startsWith("/") || /[\r\n]/.test(executable)) throw codedError("invalid-executable", "Executable must be an absolute local path");
  if (operation === "snapshot") {
    const processes = await listCodexProcesses(executable);
    process.stdout.write(`${JSON.stringify({ status: "ok", pids: processes.map(({ pid }) => pid) })}\n`);
    return;
  }
  if (operation === "wait-new") {
    const before = JSON.parse(option(args, "--before"));
    const timeoutMs = Number(option(args, "--timeout-ms"));
    const launched = await waitForNewTrustedProcess({
      beforePids: before,
      timeoutMs,
      listProcesses: () => listCodexProcesses(executable),
    });
    process.stdout.write(`${JSON.stringify({ status: "ready", pid: launched.pid, startedAt: launched.startedAt })}\n`);
    return;
  }
  if (operation === "verify-listener") {
    const pid = Number(option(args, "--pid"));
    const expectedStartedAt = option(args, "--started-at");
    const port = Number(option(args, "--port"));
    const codex = await listCodexProcesses(executable);
    const root = codex.find((item) => item.pid === pid && item.startedAt === expectedStartedAt);
    const listeners = await listenerPids(port);
    const tree = await processTable();
    const ok = Boolean(root) && listenerTreeOwned(pid, listeners, tree) && await cdpReady(port);
    process.stdout.write(`${JSON.stringify({ status: ok ? "ready" : "pending", code: ok ? "ok" : "cdp-process-tree-unverified" })}\n`);
    if (!ok) process.exitCode = 2;
    return;
  }
  throw codedError("invalid-operation", "Usage: lifecycle-process-guard.mjs snapshot|wait-new|verify-listener");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "failed", code: error.code ?? "process-guard-failed" })}\n`);
    process.exitCode = 1;
  });
}
