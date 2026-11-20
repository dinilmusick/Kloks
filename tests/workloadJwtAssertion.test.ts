import { describe, expect, it } from 'vitest';
import { signPrivateKeyJwtClientAssertion } from '../packages/backend/src/auth/WorkloadJwtAssertion.js';

async function signer(extractable = false) {
  const keys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, extractable, ['sign', 'verify']);
  return {
    privateKey: keys.privateKey, publicKey: keys.publicKey,
    clientId: 'srkl-worker-client', keyId: 'key-2026', algorithm: 'RS256' as const,
  };
}
function unpack(segment: string): any {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}
describe('Non-extractable workload JWT signer', () => {
  it('signs short-lived OAuth assertion with no embedded private material', async () => {
    const account = await signer();
    const endpoint = 'https://luth.example.test/api/auth/oauth2/token';
    const token = await signPrivateKeyJwtClientAssertion(account, endpoint);
    const [header, payload, signature] = token.split('.');
    expect(unpack(header).alg).toBe('RS256');
    expect(unpack(payload).iss).toBe('srkl-worker-client');
    expect(unpack(payload).sub).toBe('srkl-worker-client');
    expect(unpack(payload).aud).toBe(endpoint);
    expect(unpack(payload).exp - unpack(payload).iat).toBe(60);
    expect(token).not.toMatch(/PRIVATE KEY|BEGIN|client_secret/);
    expect(await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' },
      account.publicKey,
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(header + '.' + payload))).toBe(true);
    const second = await signPrivateKeyJwtClientAssertion(account, endpoint);
    expect(unpack(second.split('.')[1]).jti).not.toBe(unpack(payload).jti);
  });
  it('denies extractable private keys, untrusted OAuth endpoint and wrong algorithm', async () => {
    const good = await signer(false), bad = await signer(true);
    const endpoint = 'https://luth.example.test/api/auth/oauth2/token';
    await expect(signPrivateKeyJwtClientAssertion(bad, endpoint))
      .rejects.toThrow('UNSAFE_WORKLOAD_SIGNING_KEY');
    await expect(signPrivateKeyJwtClientAssertion(good,
      'https://evil.example.test/oauth2/token')).rejects.toThrow(
      'UNTRUSTED_WORKLOAD_TOKEN_ENDPOINT');
    await expect(signPrivateKeyJwtClientAssertion({ ...good, algorithm: 'ES256' },
      endpoint)).rejects.toThrow('WORKLOAD_SIGNER_ALGORITHM_MISMATCH');
  });
});
