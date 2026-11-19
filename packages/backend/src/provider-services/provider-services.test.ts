import { describe, expect, it, vi } from 'vitest';
import { calculateProviderCapacity } from './capacity.js';
import { getProviderService, listRecognizedAccountServices } from './registry.js';
import { createProviderClient } from './client.js';
import { fetchCloudflareCapacity } from './cloudflare.js';
import { fetchVercelCapacity } from './vercel.js';
import type { ProviderUsageSnapshot } from './types.js';

const now = new Date('2026-11-17T12:00:00Z');
const base: ProviderUsageSnapshot = {
  providerId: 'cloudflare', serviceId: 'cloudflare', accountId: 'acc',
  capturedAt: now.toISOString(), coverage: 'complete', metrics: [{
    id: 'requests', label: 'Requests', unit: 'count', window: 'day',
    used: 25, limit: 100, source: 'provider', enforceable: true,
    resetAt: '2026-11-18T00:00:00Z',
  }],
};
describe('canonical provider services', () => {
  it('recognizes implemented services but never treats catalog-only adapters as available', () => {
    expect(listRecognizedAccountServices().some(p => p.id === 'cloudflare')).toBe(true);
    expect(listRecognizedAccountServices().some(p => p.id === 'railway')).toBe(true);
    expect(getProviderService('CLOUDFLARE_WORKERS')?.id).toBe('cloudflare');
    expect(getProviderService('fly')?.renewal).toBe('trial')
    expect(getProviderService('fly')?.usageImplemented).toBe(false)
    expect(getProviderService('koyeb')?.status).toBe('catalogued');
  });
  it('scores only confirmed renewable quota windows and fails closed', () => {
    expect(calculateProviderCapacity(base, now).weight).toBe(0.75);
    expect(calculateProviderCapacity({ ...base, metrics: [{ ...base.metrics[0], used: 100 }] }, now).status).toBe('exhausted');
    expect(calculateProviderCapacity({ ...base, metrics: [{ ...base.metrics[0], source: 'estimate' }] }, now).status).toBe('unknown');
    expect(calculateProviderCapacity({ ...base, coverage: 'partial' }, now).weight).toBe(0);
    expect(calculateProviderCapacity(base, new Date('2026-11-18T00:01:00Z')).weight).toBe(0);
  });
  it('never sends a key to a foreign origin', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createProviderClient({ providerId: 'vercel', accountId: 'a', credential: 'secret' }, transport);
    await expect(client.request({ path: '//attacker.invalid/path' })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects encoded API traversal before sending account credentials', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createProviderClient({
      providerId: 'gitlab', accountId: 'a', credential: 'secret',
    }, transport);
    for (const path of ['/api/%2e%2e/escape','/api/%252e%252e/escape',
      '/api/../escape','/\\bad.test/path']) {
      await expect(client.request({ path })).rejects.toThrow();
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects nested traversal before including provider credentials', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createProviderClient({
      providerId: 'github', accountId: 'a', credential: 'secret',
    }, transport);
    for (const path of [
      '/api/%2525252e%2525252e/secret', '/api/team%2F..%2Fsecret',
      '/api/%252f..%252fsecret', '/api/%3fquery', '//other.example/secret',
    ]) await expect(client.request({ path })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    const gitlab = createProviderClient({
      providerId: 'gitlab', accountId: 'a', credential: 'secret',
    }, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(gitlab.request({ path: '/api/v4/projects/team%2Frepo' }))
      .resolves.toMatchObject({ status: 200 });
  });
  it('uses a UTC daily Cloudflare quota with provider-reported zero, not synthetic traffic', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { viewer: { accounts: [
        { workersInvocationsAdaptive: [] },
      ] } } }), { status: 200 }));
    const snapshot = await fetchCloudflareCapacity({
      providerId: 'cloudflare', accountId: 'a', credential: 'secret',
      accountScope: 'a'.repeat(32),
    }, 'free', now, transport);
    expect(snapshot.metrics[0].used).toBe(0);
    expect(snapshot.metrics[0].limit).toBe(100_000);
    expect(snapshot.metrics[0].resetAt).toBe('2026-11-18T00:00:00.000Z');
    expect(calculateProviderCapacity(snapshot, now).status).toBe('eligible');
  });
  it('does not classify incomplete Vercel CPU telemetry as allocatable', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ function_invocation_successful_count: 2 }] }), { status: 200 }));
    const snapshot = await fetchVercelCapacity({
      providerId: 'vercel', accountId: 'a', credential: 'secret',
    }, { plan: 'hobby', windowStart: '2026-10-17T00:00:00Z',
      windowEnd: now.toISOString(), billingWindowVerified: true,
      resetAt: '2026-11-20T00:00:00Z' }, now, transport);
    expect(snapshot.coverage).toBe('partial');
    expect(calculateProviderCapacity(snapshot, now).weight).toBe(0);
  });
});
