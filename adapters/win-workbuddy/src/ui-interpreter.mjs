function fail(code) {
  throw new Error(code);
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

export function assertLiveCatalog(surfaceCatalog, styleCatalog, clientVersion = "5.2.6") {
  if (surfaceCatalog?.application !== "workbuddy" || surfaceCatalog?.platform !== "windows") fail("surface-catalog-identity-invalid");
  if (surfaceCatalog.clientVersion !== clientVersion) fail("surface-catalog-version-mismatch");
  if (surfaceCatalog.verificationStatus !== "verified") fail("surface-catalog-unverified");
  if (surfaceCatalog.transport?.verificationStatus !== "verified"
    || surfaceCatalog.transport?.localOnly !== true
    || surfaceCatalog.transport?.rollbackVerified !== true) fail("surface-transport-unverified");
  if (styleCatalog?.kind !== "theme.style-catalog" || styleCatalog.verificationStatus !== "verified") {
    fail("style-catalog-unverified");
  }
  if (styleCatalog.bindings.some((binding) => binding.runtimeStatus !== "verified")) fail("style-binding-unverified");
}

export function compileFixedStyleSnapshot(theme, surfaceCatalog, styleCatalog) {
  assertLiveCatalog(surfaceCatalog, styleCatalog);
  const variables = {};
  for (const binding of styleCatalog.bindings) {
    const value = getPath(theme, binding.source);
    if (value === undefined) continue;
    variables[binding.runtimeVariable] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return {
    kind: "cc-theme.fixed-style-snapshot",
    schemaVersion: 1,
    adapterId: "win-workbuddy-skin",
    clientVersion: surfaceCatalog.clientVersion,
    variables,
  };
}
