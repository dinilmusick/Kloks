/** Server-only AEAD. The canonical system-owned wrapping key remains in Kloks. */
export interface ProviderSecretEnvelope {
  version: 1;
  algorithm: 'AES-GCM-256';
  iv: string;
  ciphertext: string;
}
export interface BoundSecret {
  ownerUserId: string;
  id: string;
  providerId: string;
  resourceKind: string;
  accountScope: string;
  projectId: string;
  region: string;
}
const encoder = new TextEncoder();
const bytes = (value: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
};
function b64(bytesValue: Uint8Array): string {
  let raw = '';
  for (const byte of bytesValue) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64(value: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error('INVALID_PROVIDER_CIPHERTEXT');
  return Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')),
    char => char.charCodeAt(0),
  );
}
function aad(bound: BoundSecret): ArrayBuffer {
  return bytes(encoder.encode(JSON.stringify([
    'ultrst-provider-account:v1', bound.ownerUserId, bound.id,
    bound.providerId, bound.resourceKind, bound.accountScope,
    bound.projectId, bound.region,
  ])));
}
async function importWrappingKey(key: string): Promise<CryptoKey> {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(key))
    throw new Error('PROVIDER_ENCRYPTION_KEY_INVALID');
  const raw = unb64(key);
  if (raw.byteLength !== 32) throw new Error('PROVIDER_ENCRYPTION_KEY_INVALID');
  return crypto.subtle.importKey('raw', bytes(raw), { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
}
export async function encryptSavedCredential(
  secret: string, key: string, bound: BoundSecret,
): Promise<ProviderSecretEnvelope> {
  if (!secret || typeof secret !== 'string')
    throw new Error('PROVIDER_CREDENTIAL_REQUIRED');
  const imported = await importWrappingKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: bytes(iv), additionalData: aad(bound),
  }, imported, bytes(encoder.encode(secret)));
  return {
    version: 1, algorithm: 'AES-GCM-256', iv: b64(iv),
    ciphertext: b64(new Uint8Array(payload)),
  };
}
export async function decryptSavedCredential(
  envelope: ProviderSecretEnvelope, key: string, bound: BoundSecret,
): Promise<string> {
  if (!envelope || envelope.version !== 1 ||
      envelope.algorithm !== 'AES-GCM-256' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.ciphertext !== 'string')
    throw new Error('INVALID_PROVIDER_CIPHERTEXT');
  try {
    const iv = unb64(envelope.iv);
    if (iv.byteLength !== 12) throw new Error('Invalid IV');
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: bytes(iv), additionalData: aad(bound),
    }, await importWrappingKey(key), bytes(unb64(envelope.ciphertext)));
    return new TextDecoder('utf-8', { fatal:true }).decode(plaintext);
  } catch {
    throw new Error('PROVIDER_CREDENTIAL_DECRYPTION_DENIED');
  }
}
