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
});
