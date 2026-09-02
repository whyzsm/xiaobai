import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const packageRoot = new URL('../../', import.meta.url)
const packageMapUrl = new URL('../../../package-map.json', import.meta.url)

test('package map contains exactly the 33 legacy packages', async () => {
  const map = JSON.parse(await readFile(packageMapUrl, 'utf8'))
  const rows = map.packages
  assert.equal(rows.length, 33)
  assert.equal(new Set(rows.map((row) => row.legacyPackage)).size, 33)
  const dispositions = new Set(['host', 'plugin-domain', 'provider-policy', 'delete'])
  for (const row of rows) {
    for (const field of ['legacyPackage', 'disposition', 'target', 'reason', 'runtimeOwner', 'verification', 'status']) assert.equal(typeof row[field], 'string', `${row.legacyPackage} lacks ${field}`)
    assert.ok(dispositions.has(row.disposition), `${row.legacyPackage} has an unknown disposition`)
    assert.equal(row.status, 'mapped')
  }
  const actualLegacyPackages = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => (
      entry.isDirectory()
      && entry.name !== 'xiaobai-dsh-plugin'
      && entry.name !== 'context-compiler'
    ))
    .map((entry) => entry.name)
    .sort()
  assert.deepEqual(rows.map((row) => row.legacyPackage).sort(), actualLegacyPackages)
})

test('new plugin path does not depend on legacy shared or persistence/runtime packages', async () => {
  const files = (await readdir(new URL('../lib/', import.meta.url))).filter((file) => file.endsWith('.js'))
  const forbidden = /(?:loop-engineering\/packages\/(?:shared|memory-store)|(?:from|import)\s+['"][^'"]*(?:memory-store|event-store|legacy-cli|shared)[^'"]*)/u
  for (const file of files) assert.doesNotMatch(await readFile(join(new URL('../lib/', import.meta.url).pathname, file), 'utf8'), forbidden, `${file} imports a legacy runtime`)
})
