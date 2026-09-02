import path from 'node:path';
import { ConnectorEvidence, ConnectorSpec, DiscoverySource } from '../../shared/src/types';
import { readYamlFile } from '../../shared/src/fs';
import {
  ImaAdapter,
  ImaAdapterError,
  ImaGetRequest,
  ImaGetResult,
  ImaSearchRequest,
  ImaSearchResult,
  ImaTransport
} from './imaAdapter';

export interface ConnectorRuntimeOptions {
  /** Runtime-owned transport registry; credentials stay outside workspace config. */
  transports?: Record<string, ImaTransport>;
}

export class ConnectorRuntime {
  private readonly transports: Record<string, ImaTransport>;

  constructor(private readonly workspaceRoot: string, options: ConnectorRuntimeOptions = {}) {
    this.transports = options.transports ?? {};
  }

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

  /** Read-only, project-scoped IMA search entry point. */
  async searchIma(request: ImaSearchRequest, connectorId = 'ima', transport?: ImaTransport): Promise<ImaSearchResult> {
    const adapter = await this.imaAdapter(connectorId, transport);
    return adapter.search(request);
  }

  /** Read-only, project-scoped IMA get entry point. */
  async getIma(request: ImaGetRequest, connectorId = 'ima', transport?: ImaTransport): Promise<ImaGetResult> {
    const adapter = await this.imaAdapter(connectorId, transport);
    return adapter.get(request);
  }

  private async imaAdapter(connectorId: string, transport?: ImaTransport): Promise<ImaAdapter> {
    let connector: ConnectorSpec;
    try {
      connector = await readYamlFile<ConnectorSpec>(
        path.join(this.workspaceRoot, 'connectors', `${connectorId}.yaml`)
      );
    } catch {
      throw new ImaAdapterError('not-loaded', `IMA connector declaration is unavailable for ${connectorId}`, {
        connectorId
      });
    }
    if (
      connector.id !== connectorId ||
      !Array.isArray(connector.capabilities) ||
      !connector.capabilities.some((capability) => typeof capability === 'string' && /knowledge|ima/i.test(capability))
    ) {
      throw new ImaAdapterError('invalid-response', `Connector ${connectorId} is not configured as an IMA reader`);
    }
    const resolvedTransport = transport ?? this.transports[connectorId];
    if (!resolvedTransport) {
      throw new ImaAdapterError('not-loaded', `IMA transport is not loaded for connector ${connectorId}`, {
        connectorId
      });
    }
    return ImaAdapter.fromConnector(connector, resolvedTransport);
  }
}
