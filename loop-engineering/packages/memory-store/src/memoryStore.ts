import path from 'node:path';
import { LoopSpec } from '../../shared/src/types';
import { pathExists, readText, resolveWorkspacePath } from '../../shared/src/fs';

export class MemoryStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly loop: LoopSpec
  ) {}

  stateFile(): string {
    return resolveWorkspacePath(this.workspaceRoot, this.loop.persistence.memory.stateFile);
  }

  inboxFile(): string {
    return resolveWorkspacePath(this.workspaceRoot, this.loop.persistence.memory.inboxFile);
  }

  runLog(): string {
    return resolveWorkspacePath(this.workspaceRoot, this.loop.persistence.memory.runLog);
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
      path.relative(this.workspaceRoot, this.stateFile()),
      path.relative(this.workspaceRoot, this.inboxFile()),
      path.relative(this.workspaceRoot, this.runLog())
    ];
  }
}
