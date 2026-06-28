import path from 'node:path';
import { AgentSpec } from '../../shared/src/types';
import { readYamlFile } from '../../shared/src/fs';

export class AgentRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async loadAgent(fileName: string): Promise<AgentSpec> {
    return readYamlFile<AgentSpec>(path.join(this.workspaceRoot, 'agents', fileName));
  }
}
