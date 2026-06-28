import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NoteEntry } from '../../memory-protocol/src';
import { pathExists } from '../../shared/src/fs';
import { slugifyTitle } from './slug';

export function renderPattern(input: {
  title: string;
  projectId: string;
  date: string;
  sourceCases: NoteEntry[];
}): string {
  return `---\nid: pattern-${input.date}-${slugifyTitle(input.title)}\ntitle: ${JSON.stringify(input.title)}\nstatus: reviewed\ntype: pattern\nproject: ${input.projectId}\ntags:\n  - status/reviewed\n  - type/pattern\n  - project/${input.projectId}\ndomain:\n  - ai-engineering\nsource: local\naccess: private\nconfidence: medium\ncreated_at: ${input.date}\nupdated_at: ${input.date}\nsource_cases:\n${input.sourceCases.map((item) => `  - ${item.vaultRelativePath}`).join('\n')}\nevidence_count: ${input.sourceCases.length}\n---\n\n# ${input.title}\n\n## Applicability\n\n## Counterexamples\n\n## Stop Conditions\n\n## Source Cases\n\n${input.sourceCases.map((item) => `- ${item.obsidianLink}`).join('\n')}\n\n## Reuse Hint\n\n`;
}

export async function writePattern(input: {
  patternsRoot: string;
  globalPatternsPath?: string;
  title: string;
  projectId: string;
  date: string;
  sourceCases: NoteEntry[];
}): Promise<string> {
  await mkdir(input.patternsRoot, { recursive: true });
  const filePath = path.join(input.patternsRoot, `${slugifyTitle(input.title)}.md`);
  await writeFile(filePath, renderPattern(input), 'utf8');
  if (input.globalPatternsPath) {
    await appendGlobalPattern(input.globalPatternsPath, input.title, filePath);
  }
  for (const sourceCase of input.sourceCases) {
    await appendSourceCaseLink(sourceCase.path, input.title, filePath);
  }
  return filePath;
}

async function appendGlobalPattern(globalPatternsPath: string, title: string, patternPath: string): Promise<void> {
  await mkdir(path.dirname(globalPatternsPath), { recursive: true });
  const line = `- [[${patternPath.replace(/\.md$/i, '')}|${title}]]\n`;
  if ((await pathExists(globalPatternsPath)) && (await readFile(globalPatternsPath, 'utf8')).includes(line.trim())) {
    return;
  }
  await appendFile(globalPatternsPath, line, 'utf8');
}

async function appendSourceCaseLink(casePath: string, title: string, patternPath: string): Promise<void> {
  if (!(await pathExists(casePath))) return;
  const content = await readFile(casePath, 'utf8');
  const link = `- [[${patternPath.replace(/\.md$/i, '')}|${title}]]`;
  if (content.includes(link)) return;
  await appendFile(casePath, `\n## Promoted Patterns\n\n${link}\n`, 'utf8');
}
