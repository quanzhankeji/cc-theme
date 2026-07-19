import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeEvidence } from "../src/evidence-sanitizer.mjs";

test("evidence removes command lines, paths, tokens, authorization and private IDs", () => {
  const sanitized = sanitizeEvidence({
    clientVersion: "5.2.6",
    publisher: "Tencent Technology (Shenzhen) Company Limited",
    commandLine: "WorkBuddy.exe --token secret",
    executablePath: "C:\\Users\\person\\AppData\\Local\\WorkBuddy.exe",
    note: "Bearer secret.value",
    nested: { authorization: "Bearer another", accountId: "private" },
  });
  assert.equal(sanitized.clientVersion, "5.2.6");
  assert.equal(sanitized.publisher, "Tencent Technology (Shenzhen) Company Limited");
  assert.equal(sanitized.commandLine, "[REDACTED]");
  assert.equal(sanitized.executablePath, "[REDACTED]");
  assert.equal(sanitized.note, "[REDACTED]");
  assert.equal(sanitized.nested.authorization, "[REDACTED]");
  assert.equal(sanitized.nested.accountId, "[REDACTED]");
});
