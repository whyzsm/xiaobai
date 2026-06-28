import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../../shared/src/fs';
import { renderCaseTemplate } from './caseTemplate';
import { slugifyTitle } from './slug';

export interface CaseWritePlan {
  path: string;
  content: string;
  created: boolean;
}

export async function planCaseWrite(input: {
  casesRoot: string;
  title: string;
  projectId: string;
  loopId?: string;
  runId?: string;
  date: string;
  body?: string;
}): Promise<CaseWritePlan> {
  const slug = slugifyTitle(input.title);
  const filePath = await uniqueCasePath(input.casesRoot, `${input.date}-${slug}.md`);
  const id = `case-${input.date}-${slug}`;
  return {
    path: filePath,
    content: renderCaseTemplate({ ...input, id }),
    created: false
  };
}

export async function writeCase(plan: CaseWritePlan): Promise<CaseWritePlan> {
  await mkdir(path.dirname(plan.path), { recursive: true });
  await writeFile(plan.path, plan.content, 'utf8');
  return { ...plan, created: true };
}

async function uniqueCasePath(root: string, filename: string): Promise<string> {
  const parsed = path.parse(filename);
  let candidate = path.join(root, filename);
  let index = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(root, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}
