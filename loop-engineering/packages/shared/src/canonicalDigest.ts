import { createHash } from 'node:crypto';

export const canonicalizationVersion = 'jcs-v1' as const;

export function canonicalizeJson(value: unknown): string {
  return serializeJson(value, new Set<object>(), '$');
}

export function digestCanonicalJson(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

export function digestJson(value: unknown): string {
  return digestCanonicalJson(canonicalizeJson(value));
}

export function digestJsonHex(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function serializeJson(value: unknown, ancestors: Set<object>, path: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertValidUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Canonical JSON rejects non-finite number at ${path}`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new Error(`Canonical JSON rejects ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`Canonical JSON rejects cyclic value at ${path}`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => serializeJson(item, ancestors, `${path}[${index}]`)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Canonical JSON rejects non-plain object at ${path}`);
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) => {
      assertValidUnicode(key, `${path} key`);
      return `${JSON.stringify(key)}:${serializeJson(record[key], ancestors, `${path}.${key}`)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`Canonical JSON rejects invalid Unicode at ${path}`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`Canonical JSON rejects invalid Unicode at ${path}`);
    }
  }
}
