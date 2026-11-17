import { describe, expect, it, vi } from 'vitest';
import { listCloudflareWorkers, listVercelProjects, getGoogleAccountProfile } from './operations.js';
const token = 'provider-secret';
describe('canonical provider operations', () => {
  it('scopes Cloudflare Worker discovery to the selected account', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ success: true, result: [{ id: 'worker-one' }] }), { status: 200 }));
    const result = await listCloudflareWorkers({
      providerId: 'cloudflare', accountId: 'acc', credential: token,
      accountScope: 'b'.repeat(32),
    }, transport);
    expect(result).toHaveLength(1);
    expect(String(transport.mock.calls[0][0])).toContain('/accounts/' + 'b'.repeat(32));
    expect(String(transport.mock.calls[0][0])).not.toContain(token);
  });
  it('scopes Vercel project discovery to a team', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ projects: [{ id: 'p1', name: 'app' }] }), { status: 200 }));
    const result = await listVercelProjects({
      providerId: 'vercel', accountId: 'acc', accountScope: 'team-test', credential: token,
    }, transport);
    expect(result[0].name).toBe('app');
    expect(String(transport.mock.calls[0][0])).toContain('teamId=team-test');
  });
  it('requires OAuth account profile and never treats an email as a credential', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ sub: 'google-user', email: 'user@example.com' }), { status: 200 }));
    const account = await getGoogleAccountProfile({
      providerId: 'google', accountId: 'acc', credential: token,
    }, transport);
    expect(account.sub).toBe('google-user');
    const req = transport.mock.calls[0][1];
    expect((req?.headers as Record<string,string>).Authorization).toBe('Bearer '+token);
  });
});
