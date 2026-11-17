/** First-class KrnlTS services for provider operations, without resident agents. */
import { createService, createServiceDefinition, type IService } from '@ultrst-armada/krnl';
import { getGoogleAccountProfile, listCloudflareAccounts, listCloudflarePages,
  listCloudflareWorkers, listVercelDeployments, listVercelProjects } from './operations.js';
import { fetchCloudflareCapacity } from './cloudflare.js';
import { fetchVercelCapacity } from './vercel.js';
import { listGeminiModels, getGeminiQuotaStatus } from './gemini.js';
import type { ProviderConnection } from './types.js';

type ConnectionInput = { connection: ProviderConnection };
const defs = {
  cloudflare: createServiceDefinition({
    id: 'kloks.external.cloudflare', name: 'Cloudflare Provider Service', version: '1.0.0',
    operations: {
      listAccounts: { id: 'cloudflare.listAccounts', name: 'listAccounts',
        handler: (input: ConnectionInput) => listCloudflareAccounts(input.connection) },
      listWorkers: { id: 'cloudflare.listWorkers', name: 'listWorkers',
        handler: (input: ConnectionInput) => listCloudflareWorkers(input.connection) },
      listPages: { id: 'cloudflare.listPages', name: 'listPages',
        handler: (input: ConnectionInput) => listCloudflarePages(input.connection) },
      quota: { id: 'cloudflare.quota', name: 'quota',
        handler: (input: ConnectionInput & { plan: 'free' | 'paid' }) =>
          fetchCloudflareCapacity(input.connection, input.plan) },
    },
  }),
  vercel: createServiceDefinition({
    id: 'kloks.external.vercel', name: 'Vercel Provider Service', version: '1.0.0',
    operations: {
      listProjects: { id: 'vercel.listProjects', name: 'listProjects',
        handler: (input: ConnectionInput) => listVercelProjects(input.connection) },
      listDeployments: { id: 'vercel.listDeployments', name: 'listDeployments',
        handler: (input: ConnectionInput) => listVercelDeployments(input.connection) },
      quota: { id: 'vercel.quota', name: 'quota',
        handler: (input: ConnectionInput & { options: Parameters<typeof fetchVercelCapacity>[1] }) =>
          fetchVercelCapacity(input.connection, input.options) },
    },
  }),
  google: createServiceDefinition({
    id: 'kloks.external.google', name: 'Google Account Service', version: '1.0.0',
    operations: {
      profile: { id: 'google.profile', name: 'profile',
        handler: (input: ConnectionInput) => getGoogleAccountProfile(input.connection) },
    },
  }),
  gemini: createServiceDefinition({
    id: 'kloks.external.google.gemini', name: 'Google Gemini Service', version: '1.0.0',
    operations: {
      listModels: { id: 'gemini.listModels', name: 'listModels',
        handler: (input: ConnectionInput) => listGeminiModels(input.connection) },
      quota: { id: 'gemini.quota', name: 'quota',
        handler: (input: ConnectionInput) => getGeminiQuotaStatus(input.connection.accountId) },
    },
  }),
};
function facade(definition: ReturnType<typeof createServiceDefinition>) {
  const instance: IService = createService(definition);
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    runtime: 'server' as const,
    deployment: 'local' as const,
    definition,
    get telemetry() { return instance.telemetry; },
    createInstance: () => createService(definition),
    execute: async <TIn = unknown, TOut = unknown>(operation: string, input: TIn): Promise<TOut> => {
      await instance.start();
      return instance.call<TIn, TOut>(operation, input);
    },
  };
}
export const CloudflareProviderService = facade(defs.cloudflare);
export const VercelProviderService = facade(defs.vercel);
export const GoogleAccountProviderService = facade(defs.google);
export const GeminiProviderService = facade(defs.gemini);
