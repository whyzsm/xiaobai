import path from 'node:path';
import { MemoryNoteKind } from '../../memory-protocol/src';

export function classifyNote(input: {
  projectRoot: string;
  filePath: string;
  frontmatterType?: string;
}): { kind: MemoryNoteKind; loopId?: string } {
  const relativePath = path.relative(input.projectRoot, input.filePath).replaceAll(path.sep, '/');
  const type = input.frontmatterType;

  if (type === 'case' || relativePath.startsWith('cases/')) return { kind: 'case' };
  if (type === 'pattern' || relativePath.startsWith('patterns/')) return { kind: 'pattern' };
  if (type === 'report' || relativePath.startsWith('reports/')) return { kind: 'report' };
  if (relativePath === 'index.md' || type === 'project-memory') return { kind: 'project-index' };
  if (relativePath === 'project-profile.md' || type === 'project-profile') return { kind: 'project-profile' };
  if (relativePath === 'active-context.md' || type === 'active-context') return { kind: 'active-context' };
  if (relativePath === 'decisions.md' || type === 'decision') return { kind: 'decision' };
  if (relativePath === 'inbox.md' || type === 'inbox') return { kind: 'inbox' };

  const loopMatch = /^loops\/([^/]+)\/([^/]+)$/.exec(relativePath);
  if (loopMatch) {
    const loopId = loopMatch[1];
    const file = loopMatch[2];
    if (file === 'state.md' || type === 'loop-state') return { kind: 'loop-state', loopId };
    if (file === 'inbox.md') return { kind: 'inbox', loopId };
    if (file === 'decisions.md') return { kind: 'decision', loopId };
  }

  return { kind: 'unknown' };
}
