import path from 'node:path';
import { LoopSpec } from '../../shared/src/types';
import { pathExists, readText } from '../../shared/src/fs';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';

export class MemoryStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly memoryRoot: string,
    private readonly loop: LoopSpec
  ) {}

  stateFile(): string {
    return resolveMemoryPath(this.memoryRoot, this.loop.persistence.memory.stateFile);
  }

  inboxFile(): string {
    return resolveMemoryPath(this.memoryRoot, this.loop.persistence.memory.inboxFile);
  }

  runLog(): string {
    return resolveMemoryPath(this.memoryRoot, this.loop.persistence.memory.runLog);
  }

  async readState(): Promise<string> {
    const state = this.stateFile();
    return (await pathExists(state)) ? readText(state) : '';
  }

  async readInbox(): Promise<string> {
    const inbox = this.inboxFile();
    return (await pathExists(inbox)) ? readText(inbox) : '';
  }

  plannedWrites(): string[] {
    return [
      displayPath(this.workspaceRoot, this.stateFile()),
      displayPath(this.workspaceRoot, this.inboxFile()),
      displayPath(this.workspaceRoot, this.runLog())
    ];
  }
}

function displayPath(workspaceRoot: string, filePath: string): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) ? filePath : relativePath;
}
