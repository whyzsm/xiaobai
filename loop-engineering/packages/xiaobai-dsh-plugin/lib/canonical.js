import { createHash } from 'node:crypto'

function normalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${path}[${index}]`))
  if (typeof value === 'object') {
    const output = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue
      if (typeof value[key] === 'function' || typeof value[key] === 'symbol') {
        throw new TypeError(`Unsupported value at ${path}.${key}`)
      }
      output[key] = normalize(value[key], `${path}.${key}`)
    }
    return output
  }
  throw new TypeError(`Unsupported value at ${path}`)
}

export function canonicalize(value) {
  return normalize(value)
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256Digest(value) {
  const input = typeof value === 'string' ? value : stableStringify(value)
  return `sha256:${createHash('sha256').update(input).digest('hex')}`
}

export function cloneCanonical(value) {
  return JSON.parse(stableStringify(value))
}
