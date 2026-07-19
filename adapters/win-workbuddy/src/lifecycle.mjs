import { evaluateCapabilityGate } from "./capability-gate.mjs";
import { operationResult } from "./operation-result.mjs";

const PHASE = {
  detect: "detect",
  preflight: "preflight",
  install: "stage",
  apply: "apply",
  launch: "launch",
  verify: "verify",
  pause: "apply",
  restore: "cleanup",
};

export async function runLifecycleOperation(operation, context) {
  const gate = evaluateCapabilityGate(context, operation);
  if (!gate.allowed) {
    return operationResult({
      operation,
      ok: false,
      code: gate.code,
      phase: PHASE[operation] ?? "preflight",
      details: {
        clientVersion: context?.client?.version ?? "unknown",
        processRunning: context?.client?.running === true,
        warnings: gate.failedChecks.slice(0, 20),
      },
    });
  }
  if (operation === "detect") {
    return operationResult({
      operation,
      ok: true,
      phase: "detect",
      details: {
        clientVersion: context.client.version,
        processRunning: context.client.running === true,
      },
    });
  }
  return operationResult({ operation, ok: false, code: "runtime-adapter-not-implemented", phase: PHASE[operation] });
}
