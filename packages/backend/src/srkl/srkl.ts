// ══════════════════════════════════════════════════════════════════════════════
// SRKL SERVICE FACADE
// Specification: APP_ARCHITECTURE_SPEC & MULTI_TARGET_BUILD_SPEC
// Exports: runtime, deployment, and service
// ══════════════════════════════════════════════════════════════════════════════

import { SrklVaultAccessClient } from './SrklVaultAccessClient.js';
import { SrklCredentialRegistry } from './SrklCredentialRegistry.js';
import { decryptVaultBufferInBrowser, hexToBytes } from './SrklCryptoClient.js';

export const runtime = {
  VaultAccessClient: SrklVaultAccessClient,
  CredentialRegistry: SrklCredentialRegistry,
  decryptVaultBufferInBrowser,
  hexToBytes,
};

export const deployment = {
  target: 'universal',
  supportedEngines: ['browser', 'worker', 'node'],
  version: '1.0.0',
};

export const service = {
  name: 'srkl',
  description: 'SRKL Ecosystem Volatile Memory Credential Vault Service',
  runtime,
  deployment,
};

export const srklService = service;
export default service;
