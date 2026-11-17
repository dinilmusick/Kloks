import { createProviderClient } from './client.js';
import type { ProviderConnection, ProviderUsageSnapshot } from './types.js';

const QUERY = `query WorkersToday($account: string, $start: string, $end: string) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(
      limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end }
    ) { sum { requests } }
  } }
}`;
function utcBounds(now: Date) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: now.toISOString(),
    resetAt: new Date(start.getTime() + 86_400_000).toISOString() };
}
/**
 * Measure Cloudflare Workers Free DAILY requests, not a fictional monthly quota.
 * Paid plans require an explicit budget policy and are not eligible by default.
 */
export async function fetchCloudflareCapacity(
  connection: ProviderConnection,
  plan: 'free' | 'paid',
  now: Date = new Date(),
  transport: typeof fetch = fetch,
): Promise<ProviderUsageSnapshot> {
  const capturedAt = now.toISOString();
  const snapshot: ProviderUsageSnapshot = {
    providerId: 'cloudflare', serviceId: 'cloudflare', accountId: connection.accountId,
    capturedAt, metrics: [], coverage: 'unavailable',
  };
  if (!/^[a-f0-9]{32}$/i.test(connection.accountScope || '')) {
    return { ...snapshot, error: 'A specific Cloudflare account tag is required' };
  }
  if (plan !== 'free') {
    return { ...snapshot, error: 'Paid usage requires a separately configured spending policy' };
  }
  try {
    const { start, end, resetAt } = utcBounds(now);
    const client = createProviderClient(connection, transport);
    const response = await client.request<{
      data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: Array<{
        sum?: { requests?: number };
      }> }> } };
      errors?: unknown[];
    }>({
      method: 'POST', path: '/client/v4/graphql',
      body: { query: QUERY, variables: { account: connection.accountScope, start, end } },
    });
    const body = response.data;
    const groups = body?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if (body.errors?.length || !Array.isArray(groups) || groups.length >= 1000)
      return { ...snapshot, error: 'Cloudflare analytics failed or exceeded the query window' };
    const values = groups.map(item => item.sum?.requests);
    if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0))
      return { ...snapshot, error: 'Cloudflare analytics request values are malformed' };
    const used = values.reduce((sum, value) => sum + (value as number), 0);
    return {
      ...snapshot, coverage: 'complete',
      metrics: [{
        id: 'workers_daily_requests', label: 'Workers requests / UTC day',
        used, limit: 100_000, unit: 'requests', window: 'day',
        source: 'provider', enforceable: true, resetAt,
      }],
    };
  } catch {
    return { ...snapshot, error: 'Cloudflare analytics could not be retrieved' };
  }
}
