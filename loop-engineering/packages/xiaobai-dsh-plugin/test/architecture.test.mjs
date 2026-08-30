import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const libRoot = new URL('../lib/', import.meta.url)

test('plugin does not import or instantiate dsh Host runtime owners', async () => {
  const files = (await readdir(libRoot)).filter((file) => file.endsWith('.js'))
  const forbiddenImports = /(?:from\s+|import\s*\(\s*)['"]@deepseek-ai\/dsh-(agent-loop|session-store|llm|tool-executor|model-adapter)/
  const forbiddenInstances = /new\s+(?:Agent|Session|Model|ToolRegistry)|(?:AgentLoop|ModelAdapter|SessionStore|ToolExecutor)\s*\(/u
  for (const file of files) {
    const source = await readFile(new URL(file, libRoot), 'utf8')
    assert.doesNotMatch(source, forbiddenImports, `${file} imports a Host runtime owner`)
    assert.doesNotMatch(source, forbiddenInstances, `${file} instantiates a Host runtime owner`)
  }
})

test('apply(ctx) only registers plugin contributions and does not create a Host Agent', async () => {
  const source = await readFile(new URL('index.js', libRoot), 'utf8')
  const applyBody = source.slice(source.indexOf('export function apply'))
  assert.doesNotMatch(applyBody, /ctx\.agents\.create|new\s+(?:Agent|Model|Session|Tool)/u)
  assert.doesNotMatch(applyBody, /(?:AgentLoop|ModelAdapter|SessionStore|ToolExecutor)\s*\(/u)
})

test('Host plugin declares the directory-picker capability dependency', async () => {
  const source = await readFile(new URL('index.js', libRoot), 'utf8')
  assert.match(source, /export const inject = \['skills', 'invariants', 'typert', 'approval', 'directoryPicker'\]/u)
})

test('direct dsh seam imports stay within the verified allowlist', async () => {
  const allowed = new Set(['@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-storage-domain'])
  const files = (await readdir(libRoot)).filter((file) => file.endsWith('.js'))
  for (const file of files) {
    const source = await readFile(join(new URL('../lib/', import.meta.url).pathname, file), 'utf8')
    for (const match of source.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+)['"]/g)) assert.ok(allowed.has(match[1]), `${file} imports unapproved dsh seam ${match[1]}`)
  }
})

test('Web bundle pins the official native directory-picker Host and Client seams', async () => {
  const patch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  const adaptivePicker = patch.find((entry) => entry.id === 'directory-picker')
  const nativePicker = patch.find((entry) => entry.insert?.some((entry) => entry.id === 'xiaobai-directory-picker-native'))
  assert.equal(adaptivePicker?.name, '@deepseek-ai/dsh-host-directory-picker-auto')
  assert.equal(adaptivePicker?.disabled, true)
  assert.deepEqual(nativePicker?.insert, [
    {
      id: 'xiaobai-directory-picker-native',
      name: '@deepseek-ai/dsh-host-directory-picker-native',
    },
    {
      id: 'xiaobai-directory-picker-native-client',
      name: '@deepseek-ai/dsh-client-ui-directory-picker-native',
    },
  ])
  assert.equal(patch.some((entry) => entry.insert?.some((insert) => insert.name === '@deepseek-ai/dsh-host-directory-picker-browse')), false)
})
