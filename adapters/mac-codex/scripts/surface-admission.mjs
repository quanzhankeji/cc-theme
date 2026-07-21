import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const DEFAULT_CATALOG_ROOT = path.join(root, "compatibility", "chatgpt-macos");
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const EXPECTED_BUNDLE_ID = "com.openai.codex";
const EXPECTED_TEAM_ID = "2DC432GLL2";

export const SURFACE_ADMISSION_KIND = "cc-theme.surface-admission-result";

function denial(code, field, message) {
  return { code, field, severity: "error", message };
}

function warning(code, field, message) {
  return { code, field, severity: "warning", message };
}

function safeVersion(value) {
  return typeof value === "string" && /^[A-Za-z0-9._+-]{1,80}$/.test(value);
}

function requiredCatalogMarkers(catalog) {
  const markers = catalog?.admission?.requiredBundleMarkers;
  if (!markers || typeof markers !== "object" || Array.isArray(markers)) throw new Error("Surface Catalog has no bounded requiredBundleMarkers map");
  const entries = Object.entries(markers);
  if (!entries.length || entries.length > 64) throw new Error("Surface Catalog requiredBundleMarkers is empty or too large");
  for (const [marker, count] of entries) {
    if (!/^[A-Za-z0-9_.:-]{3,120}$/.test(marker) || !Number.isInteger(count) || count < 1 || count > 100000) {
      throw new Error("Surface Catalog contains an invalid marker requirement");
    }
  }
  return Object.fromEntries(entries);
}

function numericVersion(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){2}$/.test(value)) return null;
  return value.split(".").map((part) => BigInt(part));
}

function compareVersions(left, right) {
  const a = numericVersion(left);
  const b = numericVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function evaluateSurfaceAdmissionFacts(facts, catalog, { compatibilityAttempt = false } = {}) {
  const diagnostics = [];
  const deny = (code, field, message) => diagnostics.push(denial(code, field, message));
  if (catalog?.kind !== "skin.ui-surface-catalog" || catalog?.schemaVersion !== "1.0.0") {
    deny("surface-evidence-invalid", "catalog", "The current Surface Catalog identity is invalid.");
  }
  if (catalog?.admission?.status !== "verified" || catalog?.admission?.failClosed !== true) {
    deny("surface-evidence-unverified", "catalog.admission", "The current Surface Catalog is not verified for fail-closed application.");
  }
  if (facts.bundleId !== EXPECTED_BUNDLE_ID || catalog?.client?.bundleId !== EXPECTED_BUNDLE_ID) {
    deny("surface-evidence-bundle-mismatch", "client.bundleId", "The installed app or Surface Catalog is not the official Codex bundle.");
  }
  if (facts.teamId !== EXPECTED_TEAM_ID || catalog?.bundleEvidence?.bundleTeamId !== EXPECTED_TEAM_ID) {
    deny("surface-evidence-signature-mismatch", "bundleEvidence.bundleTeamId", "The installed app signer does not match the verified Surface evidence.");
  }
  if (facts.version !== catalog?.client?.version) {
    deny("surface-evidence-client-version-mismatch", "client.version", `Surface evidence is for ${String(catalog?.client?.version)} but the installed client is ${String(facts.version)}.`);
  }
  if (facts.build !== catalog?.client?.build) {
    deny("surface-evidence-client-build-mismatch", "client.build", `Surface evidence build ${String(catalog?.client?.build)} does not match installed build ${String(facts.build)}.`);
  }
  if (facts.chromium !== catalog?.client?.chromium) {
    deny("surface-evidence-runtime-mismatch", "client.chromium", "The installed Chromium runtime does not match the current Surface evidence.");
  }
  if (facts.asarSha256 !== catalog?.bundleEvidence?.asarSha256) {
    deny("surface-evidence-asar-mismatch", "bundleEvidence.asarSha256", "The packaged renderer does not match the verified current Surface evidence.");
  }
  if (compatibilityAttempt) diagnostics.push(warning(
    "older-adapter-compatibility-disabled",
    "client.version",
    "This Adapter release requires exact current-host evidence; structural compatibility attempts cannot authorize apply.",
  ));
  if (catalog?.processEvidence?.status !== "verified") {
    deny("surface-evidence-process-unverified", "processEvidence.status", "The current trusted process-tree and loopback listener evidence has not completed.");
  }
  if (catalog?.liveEvidence?.captureResult !== "passed" || (catalog?.liveEvidence?.pendingRouteCoverage?.length ?? 0) !== 0) {
    deny("surface-evidence-live-unverified", "liveEvidence.captureResult", "The current privacy-preserving route evidence has not completed.");
  }
  let required = {};
  try {
    required = requiredCatalogMarkers(catalog);
  } catch (error) {
    deny("surface-evidence-invalid", "catalog.admission.requiredBundleMarkers", error.message);
  }
  for (const [marker, minimum] of Object.entries(required)) {
    const actual = facts.markerCounts?.[marker] ?? 0;
    if (actual < minimum) deny("surface-evidence-landmark-missing", `bundleMarkers.${marker}`, `Required structural marker ${marker} is missing from the installed renderer.`);
  }
  return {
    kind: SURFACE_ADMISSION_KIND,
    revision: 1,
    adapterId: "mac-codex",
    allowed: !diagnostics.some((item) => item.severity === "error"),
    code: diagnostics.find((item) => item.severity === "error")?.code ?? "ok",
    clientVersionPolicy: "always-latest",
    evidencePolicy: "current-host-evidence-required",
    compatibilityAttempt,
    installedClient: {
      bundleId: facts.bundleId ?? null,
      version: facts.version ?? null,
      build: facts.build ?? null,
      chromium: facts.chromium ?? null,
      teamId: facts.teamId ?? null,
      asarSha256: facts.asarSha256 ?? null,
    },
    catalog: {
      id: catalog?.catalogId ?? null,
      version: catalog?.client?.version ?? null,
      verifiedAt: catalog?.client?.capturedAt ?? null,
    },
    diagnostics,
  };
}

async function readBoundedJson(file) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_CATALOG_BYTES) {
    throw new Error("Surface Catalog must be a bounded regular JSON file");
  }
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function plistValue(file, key) {
  const { stdout } = await execFile("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", file], { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function signingTeamId(appPath) {
  const { stderr } = await execFile("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], { maxBuffer: 1024 * 1024 });
  return stderr.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null;
}

async function hashAndCountMarkers(file, markers) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The packaged renderer must be a regular app.asar file");
  const hash = crypto.createHash("sha256");
  const counts = Object.fromEntries(markers.map((marker) => [marker, 0]));
  const maximumMarkerBytes = Math.max(...markers.map((marker) => Buffer.byteLength(marker)));
  let tail = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
    const scan = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    for (const marker of markers) {
      const needle = Buffer.from(marker);
      let offset = 0;
      while ((offset = scan.indexOf(needle, offset)) >= 0) {
        if (offset + needle.length > tail.length) counts[marker] += 1;
        offset += needle.length;
      }
    }
    tail = scan.subarray(Math.max(0, scan.length - maximumMarkerBytes + 1));
  }
  return { asarSha256: hash.digest("hex"), markerCounts: counts };
}

export async function inspectInstalledSurface(appPath, catalogRoot = DEFAULT_CATALOG_ROOT, { compatibilityAttempt = false } = {}) {
  if (typeof appPath !== "string" || !path.isAbsolute(appPath)) throw new Error("--app must be an absolute application bundle path");
  const appStat = await fsp.lstat(appPath);
  if (!appStat.isDirectory() || appStat.isSymbolicLink()) throw new Error("The Codex application must be a regular local bundle directory");
  const plist = path.join(appPath, "Contents", "Info.plist");
  const [bundleId, version, build, chromium, teamId] = await Promise.all([
    plistValue(plist, "CFBundleIdentifier"),
    plistValue(plist, "CFBundleShortVersionString"),
    plistValue(plist, "CFBundleVersion"),
    plistValue(plist, "ChromiumBaseVersion"),
    signingTeamId(appPath),
  ]);
  if (!safeVersion(version)) throw new Error("The installed client version is unsafe or unavailable");
  let catalogVersion = version;
  if (compatibilityAttempt) {
    const candidates = [];
    for (const entry of await fsp.readdir(catalogRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink?.() || compareVersions(version, entry.name) !== 1) continue;
      const child = path.join(catalogRoot, entry.name);
      const stat = await fsp.lstat(child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) candidates.push(entry.name);
    }
    candidates.sort((left, right) => compareVersions(left, right) ?? 0);
    catalogVersion = candidates.at(-1) ?? version;
  }
  const catalogFile = path.join(catalogRoot, catalogVersion, "ui-surface-catalog.json");
  let catalog;
  try {
    catalog = await readBoundedJson(catalogFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        kind: SURFACE_ADMISSION_KIND,
        revision: 1,
        adapterId: "mac-codex",
        allowed: false,
        code: "surface-evidence-missing",
        clientVersionPolicy: "always-latest",
        evidencePolicy: "current-host-evidence-required",
        installedClient: { bundleId, version, build, chromium, teamId, asarSha256: null },
        catalog: { id: null, version: null, verifiedAt: null },
        diagnostics: [denial("surface-evidence-missing", "catalog", `No verified Surface Catalog exists for installed client ${version}.`)],
      };
    }
    throw error;
  }
  const requiredMarkers = Object.keys(requiredCatalogMarkers(catalog));
  const renderer = await hashAndCountMarkers(path.join(appPath, "Contents", "Resources", "app.asar"), requiredMarkers);
  return evaluateSurfaceAdmissionFacts(
    { bundleId, version, build, chromium, teamId, ...renderer },
    catalog,
    { compatibilityAttempt },
  );
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

async function main(argv) {
  const appPath = argument(argv, "--app");
  const catalogRoot = argument(argv, "--catalog-root") ?? DEFAULT_CATALOG_ROOT;
  const compatibilityAttempt = argv.includes("--compatibility-attempt");
  if (!appPath) throw new Error("Usage: surface-admission.mjs --app <absolute-app-bundle> [--catalog-root <absolute-directory>]");
  if (!path.isAbsolute(catalogRoot)) throw new Error("--catalog-root must be absolute");
  const result = await inspectInstalledSurface(appPath, catalogRoot, { compatibilityAttempt });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.allowed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[cc-theme-surface-admission] ${error.message}\n`);
    process.exitCode = 1;
  });
}
