import path from 'node:path';
import { ConnectorEvidence, ConnectorSpec, DiscoverySource } from '../../shared/src/types';
import { readYamlFile } from '../../shared/src/fs';

export class ConnectorRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async collect(sources: DiscoverySource[]): Promise<ConnectorEvidence[]> {
    const evidence: ConnectorEvidence[] = [];

    for (const source of sources) {
      if (!source.connector) {
        continue;
      }

      const connector = await readYamlFile<ConnectorSpec>(
        path.join(this.workspaceRoot, 'connectors', `${source.connector}.yaml`)
      );
      const mockItems = connector.mock?.[source.type];
      const items = Array.isArray(mockItems) ? mockItems : [];

      evidence.push({
        sourceType: source.type,
        connectorId: connector.id,
        items: items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      });
    }

    return evidence;
  }
}
