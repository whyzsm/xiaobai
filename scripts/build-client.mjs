import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const source = resolve(root, 'client/plugin-client.js')
const output = resolve(root, 'loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js')
await mkdir(dirname(output), { recursive: true })
await copyFile(source, output)
process.stdout.write(`Built ${output}\n`)
