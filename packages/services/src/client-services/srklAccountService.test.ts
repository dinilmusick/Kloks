import { describe, expect, it } from 'vitest';
import { SrklAccountClient, mergeSrklAccounts } from './srklAccountService';

describe('SrklAccountClient', () => {
  it('syncs explicitly against the canonical SRKL endpoint', async () => {
    let request: RequestInit | undefined;
    const client = new SrklAccountClient({
      baseUrl: 'https://srkl.example',
      userId: 'user-1',
      appId: 'depm',
      fetchImpl: async (_input, init) => {
        request = init;
        return new Response(JSON.stringify({
          success: true,
          count: 1,
          workspaceId: 'ws-1',
          accounts: [{ id: 'a1', serviceId: 'github', provider: 'GITHUB', category: 'vcs', name: 'GitHub', status: 'CONNECTED' }],
        }), { status: 200 });
      },
    });
    const result = await client.sync({ categories: ['vcs'] });
    expect(result.accounts[0].id).toBe('a1');
    expect((request?.headers as Record<string, string>)['x-app-id']).toBe('depm');
    expect(JSON.parse(String(request?.body)).categories).toEqual(['vcs']);
  });

  it('merges remote SRKL records without deleting unrelated local state', () => {
    const result = mergeSrklAccounts(
      [
        { id: 'local-a', srklAccountId: 'a1', name: 'old', deploymentCount: 4 },
        { id: 'local-b', name: 'app-only' },
      ],
      [{ id: 'a1', serviceId: 'github', provider: 'GITHUB', category: 'vcs', name: 'new', status: 'CONNECTED' }],
    );
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('new');
    expect(result[0].deploymentCount).toBe(4);
    expect(result[1].id).toBe('local-b');
  });
});
