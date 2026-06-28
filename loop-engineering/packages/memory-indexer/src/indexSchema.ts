import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';

export async function validateMemoryIndexSchema(repoRoot: string, value: unknown): Promise<string[]> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = JSON.parse(await readFile(path.join(repoRoot, 'loop-engineering', 'schemas', 'memory-index.schema.json'), 'utf8'));
  const validate = ajv.compile(schema);
  if (validate(value)) {
    return [];
  }
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'}: ${error.message ?? 'invalid value'}`);
}
