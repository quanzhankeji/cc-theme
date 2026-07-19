import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeSkinTheme } from "./skin-theme.mjs";
import { loadStyleCatalog } from "./theme-style-catalog.mjs";
import { loadStyleOverrides, transactStyleOverrides } from "./theme-style-overrides.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const contractPath = path.join(root, "contracts", "runtime-override-transaction.json");
const REQUEST_KIND = "cc-theme.runtime-override-request";
const RESULT_KIND = "cc-theme.runtime-override-result";
const MAX_REQUEST_BYTES = 1024 * 1024;
const REQUEST_KEYS = new Set([
  "kind", "adapterId", "operation", "themeDir", "source", "values", "runtimePreferences",
  "baseValues", "baseRuntimePreferences",
]);

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

async function loadThemeFromDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("themeDir must be an absolute local directory");
  const requested = path.resolve(directory);
  const directoryStat = await fs.lstat(requested);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("themeDir must be a real local directory");
  const real = await fs.realpath(requested);
  const file = path.join(real, "theme.json");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error("themeDir/theme.json must be a bounded regular file");
  return normalizeSkinTheme(JSON.parse(await fs.readFile(file, "utf8")), "Runtime override Theme");
}

export async function executeRuntimeOverrideRequest(request, options = {}) {
  try {
    const input = plainObject(request, "Runtime override request");
    const unknown = Object.keys(input).filter((key) => !REQUEST_KEYS.has(key));
    if (unknown.length) throw new Error(`Runtime override request contains unsupported fields: ${unknown.join(", ")}`);
    if (input.kind !== REQUEST_KIND || input.adapterId !== "mac-codex" || !["inspect", "mutate"].includes(input.operation)) {
      throw new Error("Runtime override request has an invalid identity");
    }
    if (input.operation === "mutate" && !["local-editor", "cc-theme-manager"].includes(input.source)) {
      throw new Error("Runtime override mutation source must be local-editor or cc-theme-manager");
    }
    const [theme, catalog] = await Promise.all([loadThemeFromDirectory(input.themeDir), loadStyleCatalog()]);
    const state = input.operation === "inspect"
      ? await loadStyleOverrides(theme, catalog, options)
      : await transactStyleOverrides(theme, catalog, {
        source: input.source,
        values: input.values,
        runtimePreferences: input.runtimePreferences,
        baseValues: input.baseValues,
        baseRuntimePreferences: input.baseRuntimePreferences,
      }, options);
    return {
      kind: RESULT_KIND,
      revision: 1,
      adapterId: "mac-codex",
      operation: input.operation,
      status: "success",
      code: "ok",
      themeId: theme.id,
      values: state.values,
      runtimePreferences: state.runtimePreferences,
      overrideStatus: state.status,
      transactionRevision: state.transactionRevision,
      quarantine: state.quarantine,
      diagnostics: state.diagnostics ?? [],
      conflicts: state.conflicts ?? [],
    };
  } catch (error) {
    return {
      kind: RESULT_KIND,
      revision: 1,
      adapterId: "mac-codex",
      operation: request?.operation ?? "unknown",
      status: "failed",
      code: /busy/i.test(error.message) ? "transaction-busy" : /theme/i.test(error.message) ? "theme-invalid" : "invalid-request",
      message: error.message,
    };
  }
}

async function readRequest(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("--request must be an absolute local JSON file");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) throw new Error("Runtime override request must be a bounded regular JSON file");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main(argv) {
  const [operation, ...args] = argv;
  if (operation === "describe") {
    process.stdout.write(await fs.readFile(contractPath, "utf8"));
    return;
  }
  if (operation !== "run") throw new Error("Usage: runtime-override-transaction.mjs describe | run --request <absolute-json>");
  const index = args.indexOf("--request");
  const result = await executeRuntimeOverrideRequest(await readRequest(args[index + 1]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "success") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[cc-theme-runtime-overrides] ${error.message}\n`);
    process.exitCode = 1;
  });
}
