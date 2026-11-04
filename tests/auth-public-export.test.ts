import { describe, expect, it } from 'vitest';
import {
  CanonicalAuthClient,
  DEFAULT_LUTH_URL,
  LuthAuthClient,
  createCanonicalAuthClient,
  createLuthAuthClient,
} from '@ultrst-armada/kloks/auth';

describe('Kloks public authentication package export', () => {
  it('resolves the canonical auth subpath and compatibility aliases', () => {
    expect(CanonicalAuthClient).toBe(LuthAuthClient);
    expect(createCanonicalAuthClient).toBe(createLuthAuthClient);
    const client = createCanonicalAuthClient({
      ecosystemId: 'ultrst-armada',
      applicationId: 'kloks-public-export-test',
      origin: 'https://example.test',
      autoRegister: false,
    });
    expect(client.applicationId).toBe('kloks-public-export-test');
    expect(client.luthUrl).toBe(DEFAULT_LUTH_URL);
    expect(typeof client.refreshSession).toBe('function');
  });
});
