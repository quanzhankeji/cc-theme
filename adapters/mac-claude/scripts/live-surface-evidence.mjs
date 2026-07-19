import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const EVIDENCE_KIND = "cc-theme.live-surface-evidence";
export const EVIDENCE_SCHEMA_VERSION = 1;

const forbiddenKeys = new Set([
  "innerText", "textContent", "value", "accessibleName", "aria-label",
  "title", "url", "href", "src", "currentSrc", "query", "search", "hash",
]);

const forbiddenKeyPattern = /(?:^|_)(?:inner.?text|text.?content|accessible.?name|aria.?label|current.?src)(?:$|_)/i;

export function validateLiveSurfaceEvidence(record, options = {}) {
  const errors = [];
  const secrets = Array.isArray(options.forbiddenValues)
    ? options.forbiddenValues.filter((value) => typeof value === "string" && value)
    : [];

  const visit = (value, path = "$") => {
    if (typeof value === "string") {
      for (const secret of secrets) {
        if (value.includes(secret)) errors.push(`${path} contains a forbidden value`);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key) || forbiddenKeyPattern.test(key)) {
        errors.push(`${path}.${key} is forbidden by the structure-only evidence policy`);
      }
      visit(child, `${path}.${key}`);
    }
  };

  if (record?.kind !== EVIDENCE_KIND) errors.push(`kind must be ${EVIDENCE_KIND}`);
  if (record?.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}`);
  }
  if (record?.privacy?.policy !== "structure-only-v1" || record?.privacy?.structuralOnly !== true) {
    errors.push("structure-only privacy declaration is required");
  }
  if (record?.privacy?.rawArtifactsCommitted !== false) {
    errors.push("raw visual artifacts must not be committed");
  }
  visit(record);
  return errors;
}

export async function writeLiveSurfaceEvidence(file, record, options = {}) {
  const errors = validateLiveSurfaceEvidence(record, options);
  if (errors.length) throw new Error(errors.join("\n"));
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const current = await fs.lstat(target);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error("Evidence output must be a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return target;
}

async function main(argv) {
  const [command, file] = argv;
  if (command !== "validate" || !file) {
    throw new Error("Usage: live-surface-evidence.mjs validate <evidence.json>");
  }
  const record = JSON.parse(await fs.readFile(file, "utf8"));
  const errors = validateLiveSurfaceEvidence(record);
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify({ pass: true, kind: record.kind, schemaVersion: record.schemaVersion })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
