import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const OPERATION_RESULT_KIND = "cc-theme.operation-result";
const OPERATIONS = new Set(["check", "preflight", "apply", "verify", "pause", "restore"]);
const STATUSES = new Set(["ok", "failed", "partial", "skipped"]);
const PHASES = {
  check: "check",
  preflight: "preflight",
  apply: "apply",
  verify: "verify",
  pause: "cleanup",
  restore: "cleanup",
};

export function operationResult({ operation, status, code, message, changed = false, details = {} }) {
  if (!OPERATIONS.has(operation)) throw new Error("Invalid CC Theme operation");
  if (!STATUSES.has(status)) throw new Error("Invalid CC Theme operation status");
  if (typeof code !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(code)) throw new Error("Invalid operation code");
  if (typeof message !== "string" || !message.trim() || message.length > 320) throw new Error("Invalid operation message");
  if (!details || typeof details !== "object" || Array.isArray(details)) throw new Error("Invalid operation details");
  return {
    kind: OPERATION_RESULT_KIND,
    schemaVersion: 1,
    adapter: "mac-workbuddy",
    operation,
    phase: PHASES[operation],
    status,
    ok: status === "ok" || status === "skipped",
    changed: changed === true,
    code,
    message: message.trim(),
    details,
  };
}

export async function writeOperationResult(file, result) {
  const output = path.resolve(file);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function valueFor(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

async function main(args) {
  const operation = valueFor(args, "operation");
  const status = valueFor(args, "status");
  const code = valueFor(args, "code");
  const message = valueFor(args, "message");
  const output = valueFor(args, "output");
  const detailsJson = valueFor(args, "details-json", "{}");
  const changed = valueFor(args, "changed", "false") === "true";
  if (detailsJson.length > 8192) throw new Error("--details-json is too large");
  const details = JSON.parse(detailsJson);
  const result = operationResult({ operation, status, code, message, changed, details });
  if (output) await writeOperationResult(output, result);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[cc-theme-operation] ${error.message}\n`);
    process.exitCode = 1;
  }
}
