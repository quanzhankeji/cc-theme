import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE_MARKER = ".cc-theme-workspace.json";

function validMarker(directory) {
  const marker = path.join(directory, WORKSPACE_MARKER);
  try {
    const metadata = lstatSync(marker);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const value = JSON.parse(readFileSync(marker, "utf8"));
    return value.kind === "cc-theme.workspace" && value.schemaVersion === 1;
  } catch {
    return false;
  }
}

export function findWorkspaceRoot(start) {
  let current = path.resolve(start);
  try {
    if (lstatSync(current).isFile()) current = path.dirname(current);
  } catch {
    // A non-existent child still has useful ancestors to inspect.
  }
  while (true) {
    if (validMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`CC Theme workspace marker not found from ${path.resolve(start)}`);
}

export function resolveWorkspaceRoot({ anchor = fileURLToPath(import.meta.url), cwd = process.cwd() } = {}) {
  const explicit = process.env.CC_THEME_REPOSITORY_ROOT;
  if (explicit) return findWorkspaceRoot(explicit);
  const candidates = [anchor, cwd].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return findWorkspaceRoot(candidate);
    } catch {
      // Try the next trusted local anchor.
    }
  }
  throw new Error("CC Theme workspace root is unavailable");
}
