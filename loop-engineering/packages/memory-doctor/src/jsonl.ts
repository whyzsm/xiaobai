import { readText } from '../../shared/src/fs';

export async function validateJsonl(filePath: string): Promise<string[]> {
  const errors: string[] = [];
  const content = await readText(filePath);
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${filePath}:${index + 1}: ${message}`);
    }
  });
  return errors;
}
