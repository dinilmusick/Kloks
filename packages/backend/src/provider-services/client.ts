import { resolveTrustedApiUrl } from '@dinilmusick/gutts/urls/safety';
import { getProviderService, resolveProviderServiceId } from './registry.js';
import type { ProviderConnection } from './types.js';

const origins: Record<string, string> = {
  cloudflare: 'https://api.cloudflare.com',
  vercel: 'https://api.vercel.com',
  railway: 'https://backboard.railway.com',
  fly: 'https://api.machines.dev',
  render: 'https://api.render.com',
  'google-cloud-run': 'https://run.googleapis.com',
  google: 'https://www.googleapis.com',
  'google-gemini': 'https://generativelanguage.googleapis.com',
  'google-drive': 'https://www.googleapis.com',
  github: 'https://api.github.com',
  gitlab: 'https://gitlab.com',
  dropbox: 'https://api.dropboxapi.com',
};
export interface ProviderRequest {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  query?: Record<string, string | number | boolean>;
}
export interface ProviderResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}
/** Server-side only: callers resolve scoped credentials from SRKL/Luth before creation. */
export function createProviderClient(connection: ProviderConnection, transport: typeof fetch = fetch) {
  const id = resolveProviderServiceId(connection.providerId);
  const definition = getProviderService(id);
  const origin = origins[id];
  if (!origin || definition?.status !== 'ready' || !definition.apiImplemented)
    throw new Error('Provider API integration is not implemented: ' + id);
  if (!connection.accountId || !connection.credential?.trim())
    throw new Error('A vault account and credential are required');

  async function request<T = unknown>(options: ProviderRequest): Promise<ProviderResponse<T>> {
    const target = resolveTrustedApiUrl(origin, options.path);
    for (const [key, value] of Object.entries(options.query || {}))
      target.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Accept: 'application/json' };
    const secret = connection.credential.trim();
    if (id === 'google-gemini') headers['x-goog-api-key'] = secret;
    else headers.Authorization = 'Bearer ' + secret;
    if (id === 'github') {
      headers.Accept = 'application/vnd.github+json';
      headers['X-GitHub-Api-Version'] = '2022-11-28';
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await transport(target.toString(), {
      method: options.method || 'GET', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error('Provider ' + id + ' returned HTTP ' + response.status);
    const data = await response.json() as T;
    return { data, status: response.status, headers: response.headers };
  }
  return { providerId: id, request };
}
