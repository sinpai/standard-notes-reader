/**
 * Font files are stored as text in the plugin's synced data. TrueType/OpenType files compress
 * well, so they are gzipped first; WOFF/WOFF2 are already compressed and are stored as-is.
 */

type Base64Uint8Array = Uint8ArrayConstructor & { fromBase64?: (value: string) => Uint8Array }
type Base64Bytes = Uint8Array & { toBase64?: () => string }

export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as Base64Bytes).toBase64
  if (native) {
    return native.call(bytes)
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const native = (Uint8Array as Base64Uint8Array).fromBase64
  if (native) {
    return native(value)
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export const canCompress = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return transform(bytes, new CompressionStream('gzip'))
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return transform(bytes, new DecompressionStream('gzip'))
}

/** zlib-wrapped deflate, as used by WOFF 1.0 tables. */
export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return transform(bytes, new DecompressionStream('deflate'))
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Response(bytes as BodyInit).body
  if (!body) {
    throw new Error('Could not read data')
  }
  const output = await new Response(body.pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(output)
}
