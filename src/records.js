/** Normalize optional object fields; reject values that JSON would silently change. */
export function jsonRecord(
  value,
  path = 'record',
  seen = new Set(),
  depth = 0,
) {
  if (depth > 64) throw new TypeError(`${path}: JSON nesting exceeds 64 levels`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object')
    throw new TypeError(`${path}: value must be finite JSON data`)
  if (seen.has(value)) throw new TypeError(`${path}: cyclic JSON data`)
  if (
    !Array.isArray(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${path}: JSON objects must be plain data objects`)
  }
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError(`${path}: JSON cannot retain symbol keys`)
  seen.add(value)
  let result
  if (Array.isArray(value)) {
    result = Array.from(value, (item, i) =>
      jsonRecord(item, `${path}[${i}]`, seen, depth + 1),
    )
  } else {
    const entries = []
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable) continue
      if (!('value' in descriptor))
        throw new TypeError(`${path}.${key}: JSON accessors are unsupported`)
      if (descriptor.value === undefined) continue
      entries.push([
        key,
        jsonRecord(descriptor.value, `${path}.${key}`, seen, depth + 1),
      ])
    }
    result = Object.fromEntries(entries)
  }
  seen.delete(value)
  return result
}
