import { describe, expect, it } from 'vitest';
import {
  CanonicalAuthClient,
  DEFAULT_LUTH_URL,
  LuthAuthClient,
  createCanonicalAuthClient,
  createLuthAuthClient,
} from './auth.js';

describe('Kloks public canonical auth entrypoint', () => {
  it('exports the shared GutTS client and compatibility aliases', () => {
    expect(DEFAULT_LUTH_URL).toMatch(/^https:\/\//);
    expect(createCanonicalAuthClient).toBe(createLuthAuthClient);
    expect(CanonicalAuthClient).toBe(LuthAuthClient);
  });

  it('creates a client with the canonical Luth authority', () => {
    const client = createLuthAuthClient({
      ecosystemId: 'ultrst-armada',
      applicationId: 'kloks-auth-contract-test',
      origin: 'https://example.test',
      autoRegister: false,
    });
    expect(client.luthUrl).toBe(DEFAULT_LUTH_URL);
    expect(client.applicationId).toBe('kloks-auth-contract-test');
    expect(typeof client.getSession).toBe('function');
    expect(typeof client.signOut).toBe('function');
  });

  it('exports universal Luth guard and canonical public routes', async () => {
    const { CANONICAL_PUBLIC_ROUTES, isPublicRoute, extractLuthToken, verifyLuthRequest } = await import('./auth.js');
    expect(Array.isArray(CANONICAL_PUBLIC_ROUTES)).toBe(true);
    expect(isPublicRoute('/api/health')).toBe(true);
    expect(isPublicRoute('/health')).toBe(true);
    expect(isPublicRoute('/api/v1/auth/me')).toBe(true);
    expect(isPublicRoute('/api/v1/workspaces/ws-1')).toBe(false);

    const publicReq = new Request('https://aiko.test/api/health');
    const publicResult = await verifyLuthRequest(publicReq);
    expect(publicResult).toBeNull();

    const protectedReq = new Request('https://aiko.test/api/v1/workspaces/ws-1');
    const protectedResult = await verifyLuthRequest(protectedReq);
    expect(protectedResult instanceof Response).toBe(true);
    expect((protectedResult as Response).status).toBe(401);
  });
});
