import { createProviderClient } from './client.js';
import type { ProviderConnection, ProviderUsageSnapshot } from './types.js';

/** Gemini key can enumerate models, but does not imply Google OAuth/Drive grants. */
export async function listGeminiModels(
  connection: ProviderConnection,
  transport: typeof fetch = fetch,
): Promise<Array<{ name: string; displayName?: string }>> {
  const client = createProviderClient({ ...connection, providerId: 'google-gemini' }, transport);
  const { data } = await client.request<{ models?: Array<{ name: string; displayName?: string }> }>({
    path: '/v1beta/models',
  });
  return Array.isArray(data?.models) ? data.models : [];
}

/** Model/project-specific quotas cannot be inferred from an account's API key. */
export function getGeminiQuotaStatus(accountId: string): ProviderUsageSnapshot {
  return {
    providerId: 'google', serviceId: 'google-gemini', accountId,
    capturedAt: new Date().toISOString(), metrics: [], coverage: 'unavailable',
    error: 'Model and project quota data must be measured or obtained from rate-limit headers',
  };
}
