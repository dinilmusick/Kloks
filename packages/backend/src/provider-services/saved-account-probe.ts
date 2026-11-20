import {
  getProviderService, listCloudflareWorkers, listCloudflarePages,
  listVercelProjects, listVercelDeployments, listFlyApps,
  listRenderServices, getRailwayAccount, listGoogleCloudRunServices,
} from './index.js';
import type { ProviderConnection } from './types.js';

/** Do not add undocumented providers: this is the live API allowlist. */
export type SavedProviderId = 'cloudflare' | 'vercel' | 'fly' |
  'railway' | 'render' | 'google-cloud-run';
export type SavedResourceKind = 'workers' | 'pages' | 'projects' |
  'deployments' | 'apps' | 'services' | 'identity';

export interface SavedProviderInput {
  providerId: SavedProviderId;
  resourceKind: SavedResourceKind;
  credential: string;
  label?: string;
  accountScope?: string;
  projectId?: string;
  region?: string;
}
export type ValidatedProviderInput = Required<SavedProviderInput>;
export interface ProviderInventory {
  providerId: SavedProviderId;
  resourceKind: SavedResourceKind;
  resources: Array<{ id: string; name: string }>;
  complete: false;
  checkedAt: string;
}
const allowed: Record<SavedProviderId, readonly SavedResourceKind[]> = {
  cloudflare: ['workers', 'pages'], vercel: ['projects', 'deployments'],
  fly: ['apps'], railway: ['identity'],
  render: ['services'], 'google-cloud-run': ['services'],
};
export function validateSavedProviderInput(value: unknown): ValidatedProviderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_PROVIDER_ACCOUNT');
  const data = value as Record<string, unknown>;
  const providerId = data.providerId;
  const resourceKind = data.resourceKind;
  if (typeof providerId !== 'string' || typeof resourceKind !== 'string' ||
      !(providerId in allowed) ||
      !allowed[providerId as SavedProviderId].includes(resourceKind as SavedResourceKind))
    throw new Error('UNSUPPORTED_PROVIDER_SCOPE');
  const definition = getProviderService(providerId);
  if (!definition || definition.status !== 'ready' || !definition.apiImplemented)
    throw new Error('PROVIDER_API_UNAVAILABLE');
  if (typeof data.credential !== 'string' || data.credential.length < 8 ||
      data.credential.length > 4096 || !/^[\x21-\x7e]+$/.test(data.credential))
    throw new Error('INVALID_PROVIDER_TOKEN');
  const label = data.label === undefined ? providerId : data.label;
  const scope = data.accountScope === undefined ? '' : data.accountScope;
  const project = data.projectId === undefined ? '' : data.projectId;
  const region = data.region === undefined ? '' : data.region;
  if (typeof label !== 'string' || !label.trim() || label.length > 120 ||
      typeof scope !== 'string' || scope.length > 128 ||
      typeof project !== 'string' || typeof region !== 'string')
    throw new Error('INVALID_PROVIDER_METADATA');
  if (providerId === 'cloudflare') {
    if (!/^[a-fA-F0-9]{32}$/.test(scope)) throw new Error('CLOUDFLARE_ACCOUNT_REQUIRED');
  } else if (providerId === 'vercel') {
    if (scope && !/^[a-zA-Z0-9_-]{1,128}$/.test(scope))
      throw new Error('INVALID_VERCEL_TEAM');
  } else if (scope) throw new Error('UNSUPPORTED_ACCOUNT_SCOPE');
  if (providerId === 'google-cloud-run') {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
        !/^[a-z][a-z0-9-]{1,40}$/.test(region))
      throw new Error('CLOUD_RUN_SCOPE_REQUIRED');
  } else if (project || region) throw new Error('UNSUPPORTED_CLOUD_RUN_SCOPE');
  return {
    providerId: providerId as SavedProviderId,
    resourceKind: resourceKind as SavedResourceKind,
    credential: data.credential, label: label.trim(), accountScope: scope,
    projectId: project, region,
  };
}
/** A read proves only current access to this exact API page, not free quota. */
export async function readProviderInventory(
  input: ValidatedProviderInput, transport: typeof fetch = fetch,
): Promise<ProviderInventory> {
  const connection: ProviderConnection = {
    providerId: input.providerId, accountId: 'verified-provider-connection',
    credential: input.credential,
    ...(input.accountScope ? { accountScope: input.accountScope } : {}),
  };
  let values: Array<{ id: unknown; name: unknown }>;
  switch (input.providerId + ':' + input.resourceKind) {
    case 'cloudflare:workers':
      values = (await listCloudflareWorkers(connection, transport))
        .map(r => ({ id: r.id, name: r.id })); break;
    case 'cloudflare:pages':
      values = (await listCloudflarePages(connection, transport))
        .map(r => ({ id: r.id || r.name, name: r.name })); break;
    case 'vercel:projects':
      values = (await listVercelProjects(connection, transport))
        .map(r => ({ id: r.id, name: r.name })); break;
    case 'vercel:deployments':
      values = (await listVercelDeployments(connection, transport))
        .map(r => ({ id: r.uid, name: r.name })); break;
    case 'fly:apps':
      values = (await listFlyApps(connection, transport))
        .map(r => ({ id: r.name, name: r.name })); break;
    case 'render:services':
      values = (await listRenderServices(connection, transport))
        .map(r => ({ id: r.service?.id, name: r.service?.name })); break;
    case 'railway:identity': {
      await getRailwayAccount(connection, transport);
      values = [{ id: 'verified', name: 'Railway account authenticated' }]; break;
    }
    case 'google-cloud-run:services':
      values = (await listGoogleCloudRunServices(
        connection, input.projectId, input.region, transport,
      )).map(r => ({ id: r.name, name: r.name.split('/').pop() }));
      break;
    default: throw new Error('UNSUPPORTED_PROVIDER_SCOPE');
  }
  if (!Array.isArray(values)) throw new Error('PROVIDER_RESPONSE_INVALID');
  function safe(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 512)
      throw new Error('PROVIDER_RESPONSE_INVALID');
    return value.replaceAll(input.credential, '[redacted]');
  }
  return {
    providerId: input.providerId, resourceKind: input.resourceKind,
    resources: values.slice(0, 50).map(r => ({ id: safe(r.id), name: safe(r.name) })),
    complete: false, checkedAt: new Date().toISOString(),
  };
}
