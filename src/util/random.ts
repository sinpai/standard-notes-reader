/**
 * Random hex identifier. Uses getRandomValues rather than randomUUID because the latter needs a
 * secure context, which an opaque-origin iframe is not guaranteed to be on every platform.
 */
export function randomId(bytes = 16): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
}
