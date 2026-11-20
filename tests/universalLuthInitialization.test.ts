import { describe, expect, it } from 'vitest';
import { createUniversalLuthRuntimeService } from '../packages/backend/src/auth/UniversalLuthInitialization.js';

const origin = 'https://luth.example.test';
const discovery = {
  protocol: 'ultrst.discovery.v1', version: 1,
  issuer: origin + '/api/auth',
  oidcDiscoveryUrl: origin + '/api/auth/.well-known/openid-configuration',
  oauthAuthorizationServerMetadataUrl: origin + '/api/auth/.well-known/oauth-authorization-server',
  configurationUrl: origin + '/api/config/v1', sessionUrl: origin + '/api/session',
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  capabilities: { email: true, google: true, authorizationCode: true, pkceS256: true,
    publicNativeClients: false, trustedWorkloads: false },
  publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
  cache: { maxAgeSeconds: 20, generatedAt: new Date().toISOString() },
};
const config = {
  protocol: 'ultrst.configuration.v1', version: 1,
  application: discovery.application, principal: { userId: 'person-1' },
  workspaceId: null,
  settings: { supportedServices: ['accounts'], deploymentOrigin: null, deploymentEnvironment: null },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '42' },
};

describe('Kloks universal Luth runtime service', () => {
  it('shares GutTS discovery/config validator and service lifecycle', async () => {
    const phases: string[] = [];
    const fetcher = async (url: RequestInfo | URL) =>
      Response.json(String(url).includes('/api/config/v1') ? config : discovery);
    const service = createUniversalLuthRuntimeService({
      runtime: 'browser', appId: 'srkl', issuerOrigin: origin,
      discoveryUrl: origin + '/api/discovery/v1',
      fetcher: fetcher as typeof fetch,
      onStateChange: phase => phases.push(phase),
    });
    expect((await service.discover()).application.appId).toBe('srkl');
    expect((await service.getConfiguration()).settings.supportedServices).toEqual(['accounts']);
    expect(service.readiness).toBe('ready');
    expect(phases).toContain('configuring');
    service.invalidate();
    expect(service.readiness).toBe('discovery');
  });
  it('fails closed on headless workloads without proven service identity', () => {
    expect(() => createUniversalLuthRuntimeService({
      runtime: 'headless', appId: 'srkl', issuerOrigin: origin,
    })).toThrow('VERIFIED_WORKLOAD_AUTHENTICATION_REQUIRED');
  });
});
