/** Normalize optional object fields; reject values that JSON would silently change. */
export function jsonRecord<T>(
  value: T,
  path = "record",
  seen = new Set<object>(),
  depth = 0,
): T {
  if (depth > 64)
    throw new TypeError(`${path}: JSON nesting exceeds 64 levels`);
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object")
    throw new TypeError(`${path}: value must be finite JSON data`);
  if (seen.has(value)) throw new TypeError(`${path}: cyclic JSON data`);
  if (
    !Array.isArray(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${path}: JSON objects must be plain data objects`);
  }
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError(`${path}: JSON cannot retain symbol keys`);
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = Array.from(value, (item, i) =>
      jsonRecord(item, `${path}[${i}]`, seen, depth + 1),
    );
  } else {
    const entries: [string, unknown][] = [];
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor))
        throw new TypeError(`${path}.${key}: JSON accessors are unsupported`);
      if (descriptor.value === undefined) continue;
      entries.push([
        key,
        jsonRecord(descriptor.value, `${path}.${key}`, seen, depth + 1),
      ]);
    }
    result = Object.fromEntries(entries);
  }
  seen.delete(value);
  return result as T;
}

/** Canonical comparison for already-normalized JSON; array order remains meaningful. */
export function jsonKey(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(jsonKey).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => JSON.stringify(key) + ":" + jsonKey(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
