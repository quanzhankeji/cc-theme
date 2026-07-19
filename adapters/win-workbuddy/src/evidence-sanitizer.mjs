const SENSITIVE_KEY = /(command.?line|argument|token|authorization|cookie|environment|full.?path|executable.?path|user.?profile|home|conversation|account.?id)/i;
const SENSITIVE_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~-]+|[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|--(?:token|authorization)\b|Authorization\s*:|[?&](?:token|key|auth)=)/i;

export function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeEvidence(entry),
    ]));
  }
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) return "[REDACTED]";
  return value;
}
