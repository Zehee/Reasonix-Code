const SECRET_KEY_RE =
  /(secret|token|password|passphrase|api[-_]?key|authorization|cookie|credential|passwd|pwd)/i;

export function redactEventValue<T>(value: T): T {
  return redactUnknown(value, null) as T;
}

function redactUnknown(value: unknown, key: string | null): unknown {
  if (Array.isArray(value)) {
    // When the parent key itself matches the secret pattern, replace the
    // whole array with a single placeholder rather than recursing — items
    // inside an `apiKeys` or `tokens` list are secrets by construction, and
    // recursing with `key=null` would drop the parent key context and
    // silently leak every element.
    if (key && SECRET_KEY_RE.test(key)) return "[redacted]";
    return value.map((item) => redactUnknown(item, null));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactUnknown(childValue, childKey);
    }
    return out;
  }
  if (typeof value === "string") {
    if ((key && SECRET_KEY_RE.test(key)) || /^Bearer\s+/i.test(value)) return "[redacted]";
  }
  return value;
}
