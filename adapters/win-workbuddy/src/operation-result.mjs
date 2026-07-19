import { sanitizeEvidence } from "./evidence-sanitizer.mjs";

export function operationResult({ operation, ok, code, phase, cleanupComplete = true, details = {} }) {
  const sanitized = sanitizeEvidence(details);
  const boundedDetails = {
    application: "workbuddy",
    transportStatus: sanitized.transportStatus ?? "unverified",
    verificationStatus: sanitized.verificationStatus ?? "unverified",
    warnings: Array.isArray(sanitized.warnings)
      ? sanitized.warnings.slice(0, 20).map((warning) => String(warning).slice(0, 160))
      : [],
  };
  if (typeof sanitized.clientVersion === "string" && /^[A-Za-z0-9.-]{1,40}$/.test(sanitized.clientVersion)) {
    boundedDetails.clientVersion = sanitized.clientVersion;
  }
  if (typeof sanitized.themeId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(sanitized.themeId)) {
    boundedDetails.themeId = sanitized.themeId;
  }
  if (Number.isInteger(sanitized.rendererGeneration)
    && sanitized.rendererGeneration >= 0 && sanitized.rendererGeneration <= 2147483647) {
    boundedDetails.rendererGeneration = sanitized.rendererGeneration;
  }
  if (sanitized.rendererGenerationScope === "renderer-session") {
    boundedDetails.rendererGenerationScope = sanitized.rendererGenerationScope;
  }
  for (const key of ["artifactManifestSha256", "archiveSha256"]) {
    if (typeof sanitized[key] === "string" && /^[a-f0-9]{64}$/.test(sanitized[key])) boundedDetails[key] = sanitized[key];
  }
  if (sanitized.artifactDigestScope === "deterministic-runtime-manifest") {
    boundedDetails.artifactDigestScope = sanitized.artifactDigestScope;
  }
  if (typeof sanitized.processRunning === "boolean") boundedDetails.processRunning = sanitized.processRunning;
  return {
    kind: "cc-theme.adapter-result",
    schemaVersion: 1,
    adapterId: "win-workbuddy-skin",
    operation,
    ok,
    status: ok ? "success" : cleanupComplete ? "failed" : "partial",
    code: ok ? "ok" : code,
    phase,
    cleanupComplete,
    details: boundedDetails,
  };
}
