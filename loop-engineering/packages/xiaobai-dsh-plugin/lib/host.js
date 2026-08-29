import { HOST_PACKAGE_NAMES, HOST_SUPPORT } from './constants.js'
import { unsupportedHost } from './errors.js'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function packageManifestPath(packageName, searchPaths = [process.cwd()]) {
  const packageParts = packageName.split('/')
  const directCandidates = []
  for (const searchPath of searchPaths) {
    directCandidates.push(join(searchPath, 'node_modules', ...packageParts, 'package.json'))
    directCandidates.push(join(searchPath, ...packageParts, 'package.json'))
    if (packageName.startsWith('@')) {
      const packageDirectory = packageName.replace('/', '+')
      try {
        for (const entry of readdirSync(searchPath)) {
          if (entry.startsWith(`${packageDirectory}@`)) directCandidates.push(join(searchPath, entry, 'node_modules', ...packageParts, 'package.json'))
        }
      } catch {
        // A missing search root is an unresolved version, not a host mismatch.
      }
    }
  }
  try {
    const entry = require.resolve(packageName, { paths: searchPaths })
    directCandidates.push(join(dirname(entry), 'package.json'))
  } catch {
    // Some dsh packages, including the CLI package, expose only a bin entry.
  }
  for (const manifest of directCandidates) {
    if (existsSync(manifest)) {
      try {
        const value = JSON.parse(readFileSync(manifest, 'utf8'))
        if (value.name === packageName) return manifest
      } catch {
        // Keep looking in the remaining candidate roots.
      }
    }
  }
  return undefined
}

export function resolvePackageVersion(packageName, options = {}) {
  const manifestPath = packageManifestPath(packageName, options.searchPaths ?? [process.cwd(), dirname(fileURLToPath(import.meta.url))])
  if (!manifestPath) return undefined
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export function probeHostVersions(options = {}) {
  const expected = options.expected ?? HOST_SUPPORT
  const packageNames = {
    dsh: HOST_PACKAGE_NAMES.dsh,
    cordis: HOST_PACKAGE_NAMES.cordis,
    ...Object.fromEntries(Object.entries(HOST_PACKAGE_NAMES.seams).map(([key, name]) => [`seams.${key}`, name])),
    ...Object.fromEntries(Object.entries(HOST_PACKAGE_NAMES.runtimes).map(([key, name]) => [`runtimes.${key}`, name])),
  }
  const versions = {}
  const unresolved = []
  const mismatches = []
  for (const [key, packageName] of Object.entries(packageNames)) {
    const expectedVersion = key === 'dsh'
      ? expected.dsh
      : key === 'cordis'
        ? expected.cordis
        : key.startsWith('seams.')
          ? expected.seams[key.slice('seams.'.length)]
          : expected.runtimes[key.slice('runtimes.'.length)]
    const actual = resolvePackageVersion(packageName, options)
    versions[key] = { packageName, expected: expectedVersion, actual }
    if (actual === undefined) unresolved.push(key)
    else if (actual !== expectedVersion) mismatches.push(key)
  }
  return { status: mismatches.length > 0 ? 'unsupported' : unresolved.length > 0 ? 'conditional' : 'verified', versions, unresolved, mismatches }
}

export function getHostService(ctx, key) {
  if (!ctx || typeof ctx.get !== 'function') return undefined
  return ctx.get(key)
}

export function requireHostService(ctx, key, method, options = {}) {
  const service = getHostService(ctx, key)
  if (!service || typeof service[method] !== 'function') throw unsupportedHost(key, method, options.actual)
  return service
}

export function probeHostCapabilities(ctx, requirements, options = {}) {
  const capabilities = {}
  for (const requirement of requirements) {
    const service = getHostService(ctx, requirement.key)
    const callable = service !== undefined && typeof service[requirement.method] === 'function'
    capabilities[requirement.key] = { available: service !== undefined, method: requirement.method, callable, condition: requirement.condition }
    if (requirement.required && !callable) throw unsupportedHost(requirement.key, requirement.method)
  }
  const versions = probeHostVersions(options)
  if (versions.mismatches.length > 0) throw unsupportedHost('host-version', 'support-matrix', versions.mismatches)
  return { host: HOST_SUPPORT, versions, capabilities }
}

export async function injectHostServices(ctx, keys, callback) {
  if (!ctx || typeof ctx.inject !== 'function') throw unsupportedHost(keys.join(','), 'inject')
  return ctx.inject(keys, callback)
}

export function registerApprovalAnswerer(ctx, answerer) {
  if (!ctx || typeof ctx.on !== 'function') throw unsupportedHost('approval', 'request')
  return ctx.on('approval/request', answerer, { prepend: true })
}
