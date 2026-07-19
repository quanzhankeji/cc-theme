import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const contractPath = path.join(root, "contracts", "theme-lifecycle-result.json");
const DEFAULT_REPORT = path.join(process.env.HOME || "", "Library", "Application Support", "CCTheme", "last-lifecycle-result.json");
const MAX_REQUEST_BYTES = 1024 * 1024;

export const LIFECYCLE_RESULT_KIND = "cc-theme.lifecycle-result";
export const LIFECYCLE_RESULT_REVISION = 1;
export const LIFECYCLE_OPERATIONS = Object.freeze(["detect", "preflight", "apply", "verify", "restore"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function portArgs(request) {
  if (request.port === undefined) return [];
  if (!Number.isInteger(request.port) || request.port < 1024 || request.port > 65535) throw new Error("port must be an integer from 1024 to 65535");
  return ["--port", String(request.port)];
}

function parseOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).filter(Boolean);
    try {
      return JSON.parse(lines.at(-1));
    } catch {
      return { summary: lines.slice(-8).join("\n") };
    }
  }
}

async function defaultRunAdapter(scriptName, args) {
  const script = path.join(here, scriptName);
  const { stdout, stderr } = await execFile(script, args, {
    cwd: root,
    maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env },
  });
  return { stdout, stderr, script };
}

function classifyFailure(operation, message) {
  const surfaceCode = message.match(/\b(surface-evidence-(?:missing|unavailable|unverified|invalid|client-version-mismatch|client-build-mismatch|runtime-mismatch|signature-mismatch|bundle-mismatch|asar-mismatch|landmark-missing))\b/)?.[1];
  if (surfaceCode) return surfaceCode;
  if (/Lifecycle operation is unsupported|preflight\.scope must|apply\.package must|port must|verify\.screenshot must|request must be|--request must/i.test(message)) {
    return "invalid-request";
  }
  if (/not found|could not locate|not installed/i.test(message) && operation === "detect") return "app-not-found";
  if (/signature|signing team|runtime|node\.js/i.test(message) && ["detect", "preflight"].includes(operation)) return "runtime-invalid";
  if (/landmark|shell marker|expected codex shell|no page matched/i.test(message)) return "adapter-landmark-missing";
  if (/cdp|loopback|transport|port .*endpoint/i.test(message)) return "transport-unavailable";
  if (/theme pack|theme config|theme image|theme media|staging|payload|contrast|unsafe|damaged/i.test(message)) return "theme-invalid";
  if (operation === "restore") return "cleanup-incomplete";
  if (operation === "apply") return "apply-failed";
  return "unexpected-failure";
}

function lifecycleResult(operation, status, code, details, message, startedAt, now) {
  return {
    kind: LIFECYCLE_RESULT_KIND,
    revision: LIFECYCLE_RESULT_REVISION,
    operation,
    status,
    code,
    clientVersionPolicy: "always-latest",
    timestamp: now().toISOString(),
    durationMs: Date.now() - startedAt,
    ...(details ? { details } : {}),
    ...(message ? { message } : {}),
  };
}

export async function executeLifecycleOperation(operation, request = {}, dependencies = {}) {
  const startedAt = Date.now();
  const now = dependencies.now ?? (() => new Date());
  const runAdapter = dependencies.runAdapter ?? defaultRunAdapter;
  try {
    if (!LIFECYCLE_OPERATIONS.includes(operation)) throw new Error(`Lifecycle operation is unsupported: ${operation}`);
    object(request, "Lifecycle request");
    let script;
    let args = [];
    let target = operation;
    if (operation === "detect") {
      script = "doctor-macos.sh";
      target = "app";
    } else if (operation === "preflight") {
      script = "doctor-macos.sh";
      const scope = request.scope ?? "adapter";
      if (!["app", "adapter"].includes(scope)) throw new Error("preflight.scope must be app or adapter");
      target = scope;
      if (scope === "adapter" || request.requireLive === true) args.push("--require-live");
      if (scope === "adapter") args.push("--require-surface-admission");
    } else if (operation === "apply") {
      script = "apply-cc-theme-macos.sh";
      if (typeof request.package !== "string" || !path.isAbsolute(request.package) ||
          !request.package.toLowerCase().endsWith(".cctheme")) {
        throw new Error("apply.package must be an absolute .cctheme path");
      }
      args = ["--file", request.package];
      if (request.noApply === true) args.push("--no-apply");
    } else if (operation === "verify") {
      script = "verify-skin-macos.sh";
      args = portArgs(request);
      if (request.reload === true) args.push("--reload");
      if (request.screenshot !== undefined) {
        if (typeof request.screenshot !== "string" || !path.isAbsolute(request.screenshot)) throw new Error("verify.screenshot must be an absolute path");
        args.push("--screenshot", request.screenshot);
      }
    } else {
      script = "restore-skin-macos.sh";
      args = portArgs(request);
      if (request.restoreBaseTheme === true) args.push("--restore-base-theme");
      if (request.restartCodex === true) args.push("--restart-codex");
      if (request.uninstall === true) args.push("--uninstall");
    }
    const result = await runAdapter(script, args);
    return lifecycleResult(operation, "success", "ok", {
      target,
      adapter: parseOutput(result.stdout),
    }, null, startedAt, now);
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    const message = stderr || error?.message || String(error);
    return lifecycleResult(operation, "failed", classifyFailure(operation, message), null, message, startedAt, now);
  }
}

export async function writeLifecycleReport(file, result) {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const existing = await fs.lstat(target);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Lifecycle report path must be a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readRequest(file) {
  if (!path.isAbsolute(file)) throw new Error("--request must be an absolute path");
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw new Error("Lifecycle request must be a regular JSON file no larger than 1 MiB");
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main(argv) {
  const [operation, ...args] = argv;
  if (operation === "describe") {
    process.stdout.write(await fs.readFile(contractPath, "utf8"));
    return;
  }
  const requestIndex = args.indexOf("--request");
  const reportIndex = args.indexOf("--report");
  const request = requestIndex >= 0 ? await readRequest(args[requestIndex + 1]) : {};
  const report = reportIndex >= 0 ? path.resolve(args[reportIndex + 1]) : DEFAULT_REPORT;
  const result = await executeLifecycleOperation(operation, request);
  if (report) await writeLifecycleReport(report, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "success") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[cc-theme-lifecycle] ${error.message}\n`);
    process.exitCode = 1;
  });
}
