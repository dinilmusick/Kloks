/**
 * Server-side private_key_jwt signer. The caller supplies a non-extractable
 * CryptoKey loaded from a platform secret manager, key vault, or signing HSM.
 * The private key never leaves this boundary or enters application bundles.
 */
export interface WorkloadAssertionSigner {
  clientId: string;
  keyId: string;
  privateKey: CryptoKey;
  /** Supported by the registered Better Auth client's JWKS. */
  algorithm: 'RS256' | 'ES256' | 'EdDSA';
}

function base64url(input: Uint8Array): string {
  let data = '';
  for (const byte of input) data += String.fromCharCode(byte);
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** A new signed assertion per token exchange prevents assertion reuse. */
export async function signPrivateKeyJwtClientAssertion(
  signer: WorkloadAssertionSigner,
  tokenEndpoint: string,
): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{3,200}$/.test(signer.clientId) ||
      !/^[A-Za-z0-9._~-]{1,200}$/.test(signer.keyId) ||
      signer.privateKey.type !== 'private' ||
      signer.privateKey.extractable ||
      !signer.privateKey.usages.includes('sign')) {
    throw new Error('UNSAFE_WORKLOAD_SIGNING_KEY');
  }
  const target = new URL(tokenEndpoint);
  if (target.protocol !== 'https:' ||
      target.pathname !== '/api/auth/oauth2/token' ||
      target.username || target.password || target.search || target.hash) {
    throw new Error('UNTRUSTED_WORKLOAD_TOKEN_ENDPOINT');
  }
  const actualAlgorithm = signer.privateKey.algorithm.name;
  if ((signer.algorithm === 'RS256' && actualAlgorithm !== 'RSASSA-PKCS1-v1_5') ||
      (signer.algorithm === 'ES256' && actualAlgorithm !== 'ECDSA') ||
      (signer.algorithm === 'EdDSA' && actualAlgorithm !== 'Ed25519')) {
    throw new Error('WORKLOAD_SIGNER_ALGORITHM_MISMATCH');
  }
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: signer.algorithm, typ: 'JWT', kid: signer.keyId };
  const payload = {
    iss: signer.clientId, sub: signer.clientId,
    aud: target.toString(), jti: crypto.randomUUID(),
    iat, nbf: iat - 1, exp: iat + 60,
  };
  const signingInput = base64url(bytes(JSON.stringify(header))) + '.' +
    base64url(bytes(JSON.stringify(payload)));
  const algorithm = signer.algorithm === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5' }
    : signer.algorithm === 'ES256'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'Ed25519' };
  const signature = await crypto.subtle.sign(
    algorithm, signer.privateKey, bytes(signingInput),
  );
  return signingInput + '.' + base64url(new Uint8Array(signature));
}
