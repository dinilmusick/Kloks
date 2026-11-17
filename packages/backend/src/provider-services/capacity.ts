import type { ProviderQuotaMetric, ProviderUsageSnapshot, CapacityDecision } from './types.js';

export function calculateProviderCapacity(
  snapshot: ProviderUsageSnapshot,
  now: Date = new Date(),
  maxAgeMs = 10 * 60_000,
): CapacityDecision {
  const checkedAt = now.toISOString();
  const unknown = (reason: string): CapacityDecision =>
    ({ status: 'unknown', weight: 0, percentRemaining: null, bottleneck: null, reason, checkedAt });
  const timestamp = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(timestamp) || now.getTime() < timestamp - 30_000
      || now.getTime() - timestamp > maxAgeMs) return unknown('Telemetry is stale or undated');
  if (snapshot.error || snapshot.coverage === 'unavailable') {
    return unknown(snapshot.error || 'Provider quota telemetry unavailable');
  }
  const enforced = snapshot.metrics.filter(m => m.enforceable);
  if (!enforced.length) return unknown('No provider-confirmed renewable quota windows');
  if (snapshot.coverage !== 'complete') return unknown('Required quota coverage is incomplete');

  let bottleneck: ProviderQuotaMetric | null = null;
  let minimum = 1;
  for (const metric of enforced) {
    if (metric.source !== 'provider' || !validQuota(metric)
        || !metric.resetAt || Date.parse(metric.resetAt) <= now.getTime()) {
      return unknown('Quota metric missing, estimated, or outside its reset window: ' + metric.id);
    }
    const remaining = Math.max(0, Math.min(1, (metric.limit! - metric.used!) / metric.limit!));
    if (!bottleneck || remaining < minimum) {
      minimum = remaining;
      bottleneck = metric;
    }
  }
  const status = minimum === 0 ? 'exhausted' : 'eligible';
  return {
    status, weight: status === 'eligible' ? Number(minimum.toFixed(4)) : 0,
    percentRemaining: Math.round(minimum * 100), bottleneck: bottleneck?.id ?? null,
    reason: status === 'eligible' ? 'Provider-measured quota remaining' : 'A required quota is exhausted',
    checkedAt,
  };
}
function validQuota(metric: ProviderQuotaMetric): boolean {
  return metric.used !== null && metric.limit !== null
    && Number.isFinite(metric.used) && Number.isFinite(metric.limit)
    && metric.used >= 0 && metric.limit > 0 && typeof metric.resetAt === 'string'
    && Number.isFinite(Date.parse(metric.resetAt));
}
