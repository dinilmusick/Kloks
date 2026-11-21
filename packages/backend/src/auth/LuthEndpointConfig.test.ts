import { describe, expect, it, vi } from 'vitest';
import { fetchLuthPublicEndpoint, parseSkipoLuthUrls } from './LuthEndpointConfig.js';

const config = { version: 1, authentication: {
  luthUrls: ['https://first.example.test', 'https://second.example.test'],
} };

describe('Skipo application-owned Luth endpoint contract', () => {
  it('preserves priority and removes duplicate endpoint origins', () => {
    expect(parseSkipoLuthUrls({ version: 1, authentication: {
      luthUrls: ['https://first.example.test', 'https://first.example.test/',
        'https://second.example.test'],
    } })).toEqual(['https://first.example.test', 'https://second.example.test']);
  });
  it('rejects missing settings, credentials, insecure/public HTTP and paths', () => {
    for (const value of [undefined, {}, { version: 2, authentication: { luthUrls: [] } },
      { version: 1, authentication: { luthUrls: ['http://public.test'] } },
      { version: 1, authentication: { luthUrls: ['https://u:p@first.example.test'] } },
      { version: 1, authentication: { luthUrls: ['https://first.example.test/api/auth'] } },
    ]) expect(() => parseSkipoLuthUrls(value)).toThrow();
  });
  it('tries a second worker after a network failure or 503', async () => {
    const transport = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(Response.json({ ready: true }));
    expect((await fetchLuthPublicEndpoint(config, '/api/status', transport)).status).toBe(200);
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      'https://first.example.test/api/status',
      'https://second.example.test/api/status',
    ]);
    const fail = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ready: true }));
    expect((await fetchLuthPublicEndpoint(config, '/api/status', fail)).status).toBe(200);
  });
  it('never retries a denied response at a different endpoint', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ error: 'no' }, { status: 403 }));
    expect((await fetchLuthPublicEndpoint(config, '/api/discovery/v1', transport)).status).toBe(403);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('fails closed when all configured workers are unavailable', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchLuthPublicEndpoint(config, '/api/health', transport))
      .rejects.toThrow('LUTH_PUBLIC_ENDPOINTS_UNAVAILABLE');
  });
});
