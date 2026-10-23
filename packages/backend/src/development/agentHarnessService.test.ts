import { describe, expect, it } from 'vitest';
import { AgentHarnessRuntime } from './agentHarnessService.js';

describe('AgentHarnessService', () => {
  it('advertises provider-specific harnesses without coupling the contract to one provider', () => {
    const providers = new AgentHarnessRuntime().providers();
    expect(providers.map(provider => provider.id)).toEqual(['deepseek', 'openai', 'google']);
    expect(providers.find(provider => provider.id === 'deepseek')?.implemented).toBe(true);
    expect(providers.find(provider => provider.id === 'openai')?.implemented).toBe(false);
    expect(providers.find(provider => provider.id === 'google')?.implemented).toBe(false);
  });

  it('exposes the DeepSeek Harness package and supported execution modes', () => {
    const provider = new AgentHarnessRuntime()
      .providers()
      .find(item => item.id === 'deepseek');

    expect(provider?.package).toBe('@deepseek-ai/dsh');
    expect(provider?.capabilities).toContain('headless');
    expect(provider?.capabilities).toContain('sdk');
  });
});
