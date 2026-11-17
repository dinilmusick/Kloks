import type { AikoIntelligenceResolver, AikoIntelligenceSpec } from './types.js';

export interface CentralAikoIntelligenceSpec {
  readonly schemaVersion: 1;
  readonly specId: string;
  readonly version: string;
  readonly spec: AikoIntelligenceSpec;
  readonly routingPolicy: {
    readonly prioritiseReasoning: boolean;
    readonly prioritiseDeterminism: boolean;
    readonly avoidPaidProviders: boolean;
  };
}

export interface CentralAikoIntelligenceOptions {
  /** Configured by the consuming app's server from a trusted Aiko deployment. */
  readonly origin: string;
  /** Resolve the caller's current Luth session and workspace, never from an agent or workflow. */
  readonly scope: () => Promise<{ workspaceId: string; luthSession: string } | null>;
  readonly send?: typeof globalThis.fetch;
}

function parseDocument(value: unknown, specId: string): CentralAikoIntelligenceSpec {
  const invalid = new Error('Central Aiko returned an invalid IntelligenceSpec.');
  if (!value || typeof value !== 'object') throw invalid;
  const document = value as Partial<CentralAikoIntelligenceSpec>;
  const { spec, routingPolicy, version } = document;
  if (document.schemaVersion !== 1 || document.specId !== specId ||
      typeof version !== 'string' || !/^[0-9a-f]{64}$/.test(version) ||
      !spec || typeof spec !== 'object' || Array.isArray(spec) || !Object.keys(spec).length ||
      Object.values(spec).some(value => typeof value !== 'number' || !Number.isFinite(value)) ||
      !routingPolicy || typeof routingPolicy.prioritiseReasoning !== 'boolean' ||
      typeof routingPolicy.prioritiseDeterminism !== 'boolean' || typeof routingPolicy.avoidPaidProviders !== 'boolean') {
    throw invalid;
  }
  return {
    schemaVersion: 1, specId, version, spec,
    routingPolicy: {
      prioritiseReasoning: routingPolicy.prioritiseReasoning,
      prioritiseDeterminism: routingPolicy.prioritiseDeterminism,
      avoidPaidProviders: routingPolicy.avoidPaidProviders,
    },
  };
}

/** A server-side resolver that checks the authority on every use, including after revocation. */
export function createCentralAikoIntelligenceResolver(options: CentralAikoIntelligenceOptions):
  AikoIntelligenceResolver & { resolve(specId?: string): Promise<CentralAikoIntelligenceSpec> } {
  const url = new URL(options.origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Central Aiko requires an HTTPS origin.');
  }
  const send = options.send ?? globalThis.fetch;
  return {
    async resolve(specId = 'preset-agent') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(specId)) {
        throw new Error('Invalid IntelligenceSpec ID.');
      }
      const scope = await options.scope();
      const workspace = scope?.workspaceId.trim();
      if (!scope?.luthSession.trim() || !workspace || workspace === '.' || workspace === '..' || workspace.includes('/')) {
        throw new Error('A verified Luth session and workspace are required.');
      }
      const path = '/api/v1/workspaces/' + encodeURIComponent(workspace) + '/intelligence-specs/' + specId;
      let response: Response;
      try {
        response = await send(new URL(path, url.origin), {
          headers: { authorization: 'Bearer ' + scope.luthSession, accept: 'application/json' },
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw new Error('Central Aiko is unavailable.');
      }
      if (response.status === 401 || response.status === 403) throw new Error('Central Aiko access was denied.');
      if (response.status === 404) throw new Error('Central Aiko IntelligenceSpec was not found.');
      if (!response.ok) throw new Error('Central Aiko is unavailable.');
      const value: unknown = await response.json().catch(() => null);
      return parseDocument(value, specId);
    },
  };
}
