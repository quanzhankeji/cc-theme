const MUTATING = new Set(["install", "apply", "launch", "pause", "restore"]);
const LIVE = new Set([...MUTATING, "verify"]);

function denied(code, failedChecks) {
  return { allowed: false, code, failedChecks };
}

export function evaluateCapabilityGate(context, operation) {
  if (!new Set(["detect", "preflight", "install", "apply", "launch", "verify", "pause", "restore"]).has(operation)) {
    return denied("operation-unsupported", ["operation"]);
  }
  const failed = [];
  if (context?.os?.product !== "Windows 11 Pro") failed.push("os.product");
  if (context?.os?.build !== "26100") failed.push("os.build");
  if (String(context?.os?.architecture).toUpperCase() !== "ARM64") failed.push("os.architecture");
  if (context?.client?.installed !== true) failed.push("client.installed");
  if (context?.client?.version !== "5.2.6") failed.push("client.version");
  if (context?.client?.publisher !== "Tencent Technology (Shenzhen) Company Limited") failed.push("client.publisher");
  if (context?.client?.signatureStatus !== "valid") failed.push("client.signatureStatus");
  if (context?.client?.packageKind !== "electron-asar") failed.push("client.packageKind");
  if (failed.length) return denied("environment-identity-unverified", failed);
  if (operation === "detect") return { allowed: true, code: "ok", failedChecks: [] };

  if (context?.surfaceCatalog?.verificationStatus !== "verified") failed.push("surfaceCatalog.verificationStatus");
  if (context?.surfaceCatalog?.clientVersion !== "5.2.6") failed.push("surfaceCatalog.clientVersion");
  if (context?.transport?.verificationStatus !== "verified") failed.push("transport.verificationStatus");
  if (context?.transport?.localOnly !== true) failed.push("transport.localOnly");
  if (context?.transport?.processBound !== true) failed.push("transport.processBound");
  if (context?.transaction?.rollbackVerified !== true) failed.push("transaction.rollbackVerified");
  if (context?.capability?.runtimeApplyAvailable !== true) failed.push("capability.runtimeApplyAvailable");
  if (failed.length) return denied("runtime-seam-unverified", failed);
  if (LIVE.has(operation) || operation === "preflight") return { allowed: true, code: "ok", failedChecks: [] };
  return denied("operation-unsupported", ["operation"]);
}

export function isMutatingOperation(operation) {
  return MUTATING.has(operation);
}
