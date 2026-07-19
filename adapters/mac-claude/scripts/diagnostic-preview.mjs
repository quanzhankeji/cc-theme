import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const contractPath = path.join(root, "contracts", "diagnostic-preview-interface.json");
const defaultStatePath = path.join(process.env.HOME || "", "Library", "Application Support", "CCTheme", "claude", "diagnostic-preview.json");
const MAX_REQUEST_BYTES = 16 * 1024;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

async function readRequest(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("--request must be an absolute path");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw new Error("Diagnostic preview request must be a bounded regular JSON file");
  }
  return object(JSON.parse(await fs.readFile(file, "utf8")), "Diagnostic preview request");
}

function parseLastJson(stdout) {
  const text = String(stdout || "").trim();
  try { return JSON.parse(text); } catch {}
  const start = text.lastIndexOf("\n{");
  if (start >= 0) return JSON.parse(text.slice(start + 1));
  throw new Error("Diagnostic preview Adapter did not return JSON");
}

export function validatePrepareRequest(request) {
  object(request, "Diagnostic preview prepare request");
  const allowed = new Set(["userConfirmed", "restartClaude"]);
  for (const key of Object.keys(request)) if (!allowed.has(key)) throw new Error(`Unknown diagnostic preview request field: ${key}`);
  if (request.userConfirmed !== true) throw new Error("diagnosticPreview.userConfirmed must be true");
  if (request.restartClaude !== true) throw new Error("diagnosticPreview.restartClaude must be true");
  return request;
}

export async function executeDiagnosticPreview(operation, request = {}, dependencies = {}) {
  const run = dependencies.run ?? (async (script, args) => execFile(path.join(here, script), args, {
    cwd: root,
    env: { ...process.env },
    maxBuffer: 8 * 1024 * 1024,
  }));
  const statePath = dependencies.statePath ?? defaultStatePath;
  if (operation === "prepare") {
    validatePrepareRequest(request);
    const result = await run("start-diagnostic-preview-macos.sh", [
      "--user-confirmed",
      "--restart-claude",
    ]);
    return parseLastJson(result.stdout);
  }
  if (operation === "status") {
    try {
      const stat = await fs.lstat(statePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error("Diagnostic preview state is unsafe");
      return JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return {
        kind: "cc-theme.diagnostic-preview-result",
        schemaVersion: 1,
        adapterId: "mac-claude",
        operation: "status",
        status: "stopped",
        pass: true,
        code: "diagnostic-preview-stopped",
        runtimeApplyAvailable: false,
        diagnosticPreviewAvailable: true,
      };
    }
  }
  if (operation === "stop") {
    object(request, "Diagnostic preview stop request");
    for (const key of Object.keys(request)) if (key !== "restartNormalClaude") throw new Error(`Unknown diagnostic preview stop field: ${key}`);
    const args = request.restartNormalClaude === true ? ["--restart-normal"] : [];
    return parseLastJson((await run("stop-diagnostic-preview-macos.sh", args)).stdout);
  }
  throw new Error(`Unsupported diagnostic preview operation: ${operation}`);
}

async function main(argv) {
  const [operation, ...args] = argv;
  if (operation === "describe") {
    process.stdout.write(await fs.readFile(contractPath, "utf8"));
    return;
  }
  const requestIndex = args.indexOf("--request");
  const request = requestIndex >= 0 ? await readRequest(args[requestIndex + 1]) : {};
  const result = await executeDiagnosticPreview(operation, request);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[cc-theme-diagnostic-preview] ${error.message}\n`);
    process.exitCode = 1;
  });
}
