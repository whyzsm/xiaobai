import path from 'node:path';
import { AgentSpec, LoopSpec } from '../../shared/src/types';
import { readYamlFile } from '../../shared/src/fs';
import {
  resolveSkillPackageAgentPath,
  resolveSkillPackageAssetsForLoop
} from '../../shared/src/skillPackageAssets';

export class AgentRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async loadAgent(fileName: string, loop?: LoopSpec): Promise<AgentSpec> {
    const assets = loop
      ? await resolveSkillPackageAssetsForLoop(this.workspaceRoot, loop)
      : undefined;
    const packagePath = resolveSkillPackageAgentPath(assets, fileName);
    return readYamlFile<AgentSpec>(packagePath ?? path.join(this.workspaceRoot, 'agents', fileName));
  }
}
