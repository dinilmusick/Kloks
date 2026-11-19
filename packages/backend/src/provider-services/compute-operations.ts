/** Read-only compute access. Credentials are resolved exclusively by trusted backends. */
import { createProviderClient } from './client.js';
import type { ProviderConnection } from './types.js';

function connectionFor(input: ProviderConnection, expected: string): ProviderConnection {
  if (input.providerId !== expected) throw new Error('Credential/provider mismatch');
  return input;
}
function requiredProject(input: string, name: string, pattern: RegExp): string {
  if (!pattern.test(input)) throw new Error('Invalid ' + name);
  return input;
}
/** Railway account tokens use Bearer; project tokens require a separate auth contract. */
export async function getRailwayAccount(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<{ name?: string; email?: string }> {
  const client = createProviderClient(connectionFor(connection, 'railway'), transport);
  const { data } = await client.request<{
    data?: { me?: { name?: string; email?: string } };
    errors?: Array<{ message?: string }>;
  }>({
    path: '/graphql/v2', method: 'POST', body: { query: 'query FrnesIdentity { me { name email } }' },
  });
  if (data.errors?.length || !data.data?.me || typeof data.data.me !== 'object')
    throw new Error('Railway account token could not be authorized');
  return data.data.me;
}
/** Fetch a page of account-owned Fly apps; trial credit is not renewable quota. */
export async function listFlyApps(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ name: string; machine_count?: number }>> {
  const client = createProviderClient(connectionFor(connection, 'fly'), transport);
  const { data } = await client.request<{
    apps?: Array<{ name: string; machine_count?: number }>;
  }>({ path: '/v1/apps' });
  if (!Array.isArray(data?.apps)) throw new Error('Invalid Fly Machines app listing');
  return data.apps;
}
/** Render services API, first page only (not a complete account inventory). */
export async function listRenderServices(
  connection: ProviderConnection, transport: typeof fetch = fetch,
): Promise<Array<{ service?: { id: string; name: string }; cursor?: string }>> {
  const client = createProviderClient(connectionFor(connection, 'render'), transport);
  const { data } = await client.request<Array<{
    service?: { id: string; name: string }; cursor?: string;
  }>>({ path: '/v1/services', query: { limit: 20 } });
  if (!Array.isArray(data)) throw new Error('Invalid Render services response');
  return data;
}
/** IAM-scoped Cloud Run v2 service discovery for an exact project and region. */
export async function listGoogleCloudRunServices(
  connection: ProviderConnection, project: string, region: string,
  transport: typeof fetch = fetch,
): Promise<Array<{ name: string; uri?: string }>> {
  connectionFor(connection, 'google-cloud-run');
  const projectId = requiredProject(project, 'Google project ID', /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/);
  const location = requiredProject(region, 'Google Cloud location', /^[a-z][a-z0-9-]{1,40}$/);
  const { data } = await createProviderClient(connection, transport).request<{
    services?: Array<{ name: string; uri?: string }>;
  }>({ path: `/v2/projects/${projectId}/locations/${location}/services` });
  if (!data || (data.services !== undefined && !Array.isArray(data.services)))
    throw new Error('Invalid Cloud Run service listing');
  return data.services || [];
}
