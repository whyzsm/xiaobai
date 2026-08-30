import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const packageRoot = new URL('../../', import.meta.url)
const packageMapUrl = new URL('../../../package-map.json', import.meta.url)
const designUrl = new URL('../../../../.trellis/tasks/archive/2026-08/08-29-dsh-plugin-workspace-integration/design.md', import.meta.url)

test('package map contains exactly the 33 legacy packages from the approved design table', async () => {
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
  const designSource = await readFile(designUrl, 'utf8')
  const design = designSource.slice(designSource.indexOf('## 33-Package Disposition'), designSource.indexOf('## Package Dependency Direction'))
  const designPackages = [...design.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1])
  assert.deepEqual(rows.map((row) => row.legacyPackage).sort(), designPackages.sort())
  const actualLegacyPackages = (await readdir(packageRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== 'xiaobai-dsh-plugin').map((entry) => entry.name).sort()
  assert.deepEqual(rows.map((row) => row.legacyPackage).sort(), actualLegacyPackages)
})

test('new plugin path does not depend on legacy shared or persistence/runtime packages', async () => {
  const files = (await readdir(new URL('../lib/', import.meta.url))).filter((file) => file.endsWith('.js'))
  const forbidden = /(?:loop-engineering\/packages\/(?:shared|memory-store)|(?:from|import)\s+['"][^'"]*(?:memory-store|event-store|legacy-cli|shared)[^'"]*)/u
  for (const file of files) assert.doesNotMatch(await readFile(join(new URL('../lib/', import.meta.url).pathname, file), 'utf8'), forbidden, `${file} imports a legacy runtime`)
})
