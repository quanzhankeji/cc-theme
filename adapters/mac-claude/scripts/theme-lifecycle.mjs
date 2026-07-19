import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const contractPath = path.join(root, "contracts", "theme-lifecycle-result.json");
const defaultReport = path.join(process.env.HOME || "", "Library", "Application Support", "CCTheme", "claude", "last-lifecycle-result.json");
const MAX_REQUEST_BYTES = 1024 * 1024;

export const LIFECYCLE_RESULT_KIND = "cc-theme.lifecycle-result";
export const LIFECYCLE_PHASES = Object.freeze(["detect", "preflight", "apply", "verify", "pause", "restore"]);
export const FAILURE_CATEGORIES = Object.freeze(["adapter-landmark", "theme-contract", "visual"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function portArgs(request) {
  if (request.port === undefined) return [];
  if (!Number.isInteger(request.port) || request.port < 1024 || request.port > 65535) {
    throw new Error("port must be an integer from 1024 to 65535");
  }
  return ["--port", String(request.port)];
}

function parseOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch {}
  const lines = text.split(/\r?\n/).filter(Boolean);
  try { return JSON.parse(lines.at(-1)); } catch {}
  return { summary: lines.slice(-4).join(" ") };
}

async function defaultRunAdapter(scriptName, args) {
  const script = path.join(here, scriptName);
  return execFile(script, args, {
    cwd: root,
    maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env },
  });
}

function classify(phase, message) {
  if (/unsupported|must be|invalid request|--request|absolute path/i.test(message)) {
    return { code: "invalid-request", category: "theme-contract" };
  }
  if (phase === "detect" && /not found|could not find/i.test(message)) {
    return { code: "app-not-found", category: "adapter-landmark" };
  }
  if (/signature|signing team|Node\.js|runtime|architecture/i.test(message)) {
    return { code: "runtime-invalid", category: "adapter-landmark" };
  }
  if (/landmark|no matching Claude renderer|no Claude renderer|expected.*shell/i.test(message)) {
    return { code: "adapter-landmark-missing", category: "adapter-landmark" };
  }
  if (/CDP|loopback|transport|endpoint|port/i.test(message)) {
    return { code: "transport-unavailable", category: "adapter-landmark" };
  }
  if (/theme|payload|media|unsafe|damaged|staging|catalog|contract/i.test(message)) {
    return { code: "theme-invalid", category: "theme-contract" };
  }
  if (phase === "restore" || phase === "pause") {
    return { code: "cleanup-incomplete", category: "theme-contract" };
  }
  if (phase === "apply") return { code: "apply-failed", category: "theme-contract" };
  return { code: "unexpected-failure", category: "theme-contract" };
}

export function validateLifecycleResult(value, label = "Lifecycle result") {
  object(value, label);
  if (value.kind !== LIFECYCLE_RESULT_KIND || value.schemaVersion !== 1) throw new Error(`${label} identity is invalid`);
  if (!LIFECYCLE_PHASES.includes(value.phase)) throw new Error(`${label} phase is invalid`);
  if (!["passed", "failed"].includes(value.status) || value.pass !== (value.status === "passed")) {
    throw new Error(`${label} status is inconsistent`);
  }
  if (value.failureCategory !== null && !FAILURE_CATEGORIES.includes(value.failureCategory)) {
    throw new Error(`${label} failureCategory is invalid`);
  }
  return value;
}

function result(phase, pass, code, failureCategory, details, message, startedAt, now) {
  return validateLifecycleResult({
    kind: LIFECYCLE_RESULT_KIND,
    schemaVersion: 1,
    phase,
    status: pass ? "passed" : "failed",
    pass,
    code,
    failureCategory: pass ? null : failureCategory,
    adapter: "mac-claude",
    targetPolicy: "verified-exact-build-with-runtime-landmarks",
    privacy: "structure-only-no-user-content",
    timestamp: now().toISOString(),
    durationMs: Date.now() - startedAt,
    ...(details ? { details } : {}),
    ...(message ? { message } : {}),
  });
}

export async function executeLifecyclePhase(phase, request = {}, dependencies = {}) {
  const startedAt = Date.now();
  const now = dependencies.now ?? (() => new Date());
  const runAdapter = dependencies.runAdapter ?? defaultRunAdapter;
  try {
    if (!LIFECYCLE_PHASES.includes(phase)) throw new Error(`Lifecycle phase is unsupported: ${phase}`);
    object(request, "Lifecycle request");
    let script;
    let args = [];
    if (phase === "detect") script = "detect-claude-macos.sh";
    if (phase === "preflight") {
      script = "doctor-macos.sh";
      if (request.requireLive === true) args.push("--require-live");
    }
    if (phase === "apply") {
      script = "apply-cc-theme-macos.sh";
      if (typeof request.packageFile !== "string" || !path.isAbsolute(request.packageFile)) {
        throw new Error("apply.packageFile must be an absolute external Theme Package path");
      }
      args = ["--file", request.packageFile];
      if (request.noApply === true) args.push("--no-apply");
    }
    if (phase === "verify") {
      script = "verify-skin-macos.sh";
      args = portArgs(request);
      if (request.reload === true) args.push("--reload");
      if (request.screenshot !== undefined) {
        if (typeof request.screenshot !== "string" || !path.isAbsolute(request.screenshot)) {
          throw new Error("verify.screenshot must be an absolute path");
        }
        args.push("--screenshot", request.screenshot);
      }
    }
    if (phase === "pause") {
      script = "pause-skin-macos.sh";
      args = portArgs(request);
    }
    if (phase === "restore") {
      script = "restore-skin-macos.sh";
      args = portArgs(request);
      if (request.restoreBaseTheme === true) args.push("--restore-base-theme");
      if (request.restartClaude === true) args.push("--restart-claude");
      if (request.uninstall === true) args.push("--uninstall");
    }
    const adapter = await runAdapter(script, args);
    return result(phase, true, "ok", null, { adapter: parseOutput(adapter.stdout) }, null, startedAt, now);
  } catch (error) {
    const message = String(error?.stderr || error?.message || error).trim();
    const failure = classify(phase, message);
    return result(phase, false, failure.code, failure.category, null, message, startedAt, now);
  }
}

export async function writeLifecycleReport(file, value) {
  const target = path.resolve(file);
  validateLifecycleResult(value);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const existing = await fs.lstat(target);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Lifecycle report path must be a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readRequest(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("--request must be an absolute path");
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw new Error("Lifecycle request must be a regular JSON file no larger than 1 MiB");
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main(argv) {
  const [phase, ...args] = argv;
  if (phase === "describe") {
    process.stdout.write(await fs.readFile(contractPath, "utf8"));
    return;
  }
  const requestIndex = args.indexOf("--request");
  const reportIndex = args.indexOf("--report");
  const request = requestIndex >= 0 ? await readRequest(args[requestIndex + 1]) : {};
  const report = reportIndex >= 0 ? path.resolve(args[reportIndex + 1]) : defaultReport;
  const lifecycle = await executeLifecyclePhase(phase, request);
  await writeLifecycleReport(report, lifecycle);
  process.stdout.write(`${JSON.stringify(lifecycle, null, 2)}\n`);
  if (!lifecycle.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[cc-theme-lifecycle] ${error.message}\n`);
    process.exitCode = 1;
  });
}
