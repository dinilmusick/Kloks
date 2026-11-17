import { createProviderClient } from './client.js';
import type { ProviderConnection, ProviderQuotaMetric, ProviderUsageSnapshot } from './types.js';

type VercelDailyRow = {
  function_invocation_successful_count?: number;
  function_invocation_error_count?: number;
  function_invocation_timeout_count?: number;
  function_execution_successful_gb_hours?: number;
  function_execution_error_gb_hours?: number;
  function_execution_timeout_gb_hours?: number;
  fluid_active_cpu_ms?: number;
};
/**
 * Collect Vercel's reported usage without synthesizing CPU, bandwidth or requests.
 * A rolling 30-day window is not assumed to equal the account's billing period.
 */
export async function fetchVercelCapacity(
  connection: ProviderConnection,
  options: {
    plan: 'hobby' | 'pro' | 'enterprise';
    windowStart: string;
    windowEnd: string;
    /** Verified period boundary from provider billing. Otherwise metrics are informational. */
    billingWindowVerified?: boolean;
    resetAt?: string;
  },
  now: Date = new Date(),
  transport: typeof fetch = fetch,
): Promise<ProviderUsageSnapshot> {
  const capturedAt = now.toISOString();
  const snapshot: ProviderUsageSnapshot = {
    providerId: 'vercel', serviceId: 'vercel', accountId: connection.accountId,
    capturedAt, metrics: [], coverage: 'unavailable',
  };
  if (!Number.isFinite(Date.parse(options.windowStart)) || !Number.isFinite(Date.parse(options.windowEnd))
      || Date.parse(options.windowEnd) <= Date.parse(options.windowStart)) {
    return { ...snapshot, error: 'Valid usage window boundaries are required' };
  }
  if (options.plan !== 'hobby')
    return { ...snapshot, error: 'Paid plan budgets are account-specific and require provider billing data' };
  try {
    const client = createProviderClient(connection, transport);
    const { data } = await client.request<{ data?: VercelDailyRow[] }>({
      path: '/v2/usage',
      query: { type: 'requests', from: options.windowStart, to: options.windowEnd,
        ...(connection.accountScope ? { teamId: connection.accountScope } : {}) },
    });
    if (!Array.isArray(data?.data))
      return { ...snapshot, error: 'Vercel usage payload did not contain verified daily rows' };
    const rows = data.data;
    const sum = (keys: (keyof VercelDailyRow)[]): number | null => {
      if (!rows.every(row => keys.every(key => row[key] === undefined
        || (typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key]! >= 0))))
        return null;
      if (!rows.some(row => keys.some(key => row[key] !== undefined))) return null;
      return rows.reduce((total, row) =>
        total + keys.reduce((n, key) => n + (row[key] || 0), 0), 0);
    };
    const enforced = !!options.billingWindowVerified && !!options.resetAt
      && Date.parse(options.resetAt) > now.getTime();
    const metric = (id: string, label: string, used: number | null,
      limit: number, unit: string): ProviderQuotaMetric => ({
      id, label, used, limit, unit, window: 'billing', resetAt: options.resetAt || null,
      enforceable: enforced, source: used === null ? 'unavailable' : 'provider',
    });
    const inv = sum(['function_invocation_successful_count',
      'function_invocation_error_count','function_invocation_timeout_count']);
    const memory = sum(['function_execution_successful_gb_hours',
      'function_execution_error_gb_hours','function_execution_timeout_gb_hours']);
    const cpuMs = sum(['fluid_active_cpu_ms']);
    const metrics = [
      metric('function_invocations', 'Function invocations', inv, 1_000_000, 'count'),
      metric('provisioned_memory', 'Provisioned memory', memory, 360, 'GB-hours'),
      metric('active_cpu', 'Active CPU', cpuMs === null ? null : cpuMs / 1000,
        4 * 3600, 'seconds'),
    ];
    return { ...snapshot, metrics,
      coverage: enforced && metrics.every(m => m.source === 'provider') ? 'complete' : 'partial' };
  } catch {
    return { ...snapshot, error: 'Vercel usage could not be retrieved' };
  }
}
