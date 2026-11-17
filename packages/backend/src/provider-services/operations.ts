import { createProviderClient } from './client.js';
import type { ProviderConnection } from './types.js';

type CfEnvelope<T> = { success: boolean; result: T; result_info?: { total_pages?: number } };
async function cfGet<T>(connection: ProviderConnection, path: string,
  transport: typeof fetch = fetch): Promise<T> {
  const client = createProviderClient({ ...connection, providerId: 'cloudflare' }, transport);
  const { data } = await client.request<CfEnvelope<T>>({ path });
  if (!data?.success) throw new Error('Cloudflare operation was rejected');
  return data.result;
}
function cfAccount(connection: ProviderConnection): string {
  if (!/^[a-f0-9]{32}$/i.test(connection.accountScope || ''))
    throw new Error('Cloudflare account tag required');
  return connection.accountScope!;
}
export async function listCloudflareWorkers(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ id: string; modified_on?: string }>> {
  return cfGet(connection, `/client/v4/accounts/${cfAccount(connection)}/workers/scripts`, transport);
}
export async function listCloudflarePages(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ name: string; id?: string }>> {
  return cfGet(connection, `/client/v4/accounts/${cfAccount(connection)}/pages/projects`, transport);
}
export async function listCloudflareAccounts(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ id: string; name: string }>> {
  return cfGet(connection, '/client/v4/accounts?per_page=50', transport);
}
export async function listVercelProjects(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ id: string; name: string }>> {
  const client = createProviderClient({ ...connection, providerId: 'vercel' }, transport);
  const { data } = await client.request<{ projects?: Array<{ id: string; name: string }> }>({
    path: '/v9/projects', query: connection.accountScope ? { teamId: connection.accountScope } : {},
  });
  if (!Array.isArray(data?.projects)) throw new Error('Unexpected Vercel projects response');
  return data.projects;
}
export async function listVercelDeployments(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ uid: string; name: string; url?: string }>> {
  const client = createProviderClient({ ...connection, providerId: 'vercel' }, transport);
  const { data } = await client.request<{ deployments?: Array<{ uid: string; name: string; url?: string }> }>({
    path: '/v6/deployments', query: { limit: 30,
      ...(connection.accountScope ? { teamId: connection.accountScope } : {}) },
  });
  if (!Array.isArray(data?.deployments)) throw new Error('Unexpected Vercel deployments response');
  return data.deployments;
}
/** Requires a Google OAuth access token with the appropriate identity scope. */
export async function getGoogleAccountProfile(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<{ sub: string; email?: string; name?: string }> {
  const client = createProviderClient({ ...connection, providerId: 'google' }, transport);
  const { data } = await client.request<{ sub: string; email?: string; name?: string }>({
    path: '/oauth2/v3/userinfo',
  });
  if (!data?.sub) throw new Error('Unexpected Google identity response');
  return data;
}
