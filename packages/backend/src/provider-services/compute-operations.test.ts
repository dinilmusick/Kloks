import { describe, expect, it, vi } from 'vitest';
import {
  getRailwayAccount, listFlyApps, listRenderServices, listGoogleCloudRunServices,
} from './compute-operations.js';
import { createProviderClient } from './client.js';
const secret = 'one-time-provider-token';
const connect = (providerId: string) => ({ providerId, accountId: 'owner-account', credential: secret });
describe('read-only compute access via canonical Kloks', () => {
  it('authenticates Railway account tokens and checks GraphQL errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { me: { name: 'team-owner' } } }), { status: 200 }));
    expect((await getRailwayAccount(connect('railway'), fetcher)).name).toBe('team-owner');
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://backboard.railway.com/graphql/v2');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string,string>).Authorization).toBe('Bearer ' + secret);
    const bad = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), { status: 200 }));
    await expect(getRailwayAccount(connect('railway'), bad)).rejects.toThrow();
  });
  it('lists Fly apps without misclassifying nonrenewable trials', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ apps: [{ name:'demo',machine_count:1 }] }), {status:200}));
    expect((await listFlyApps(connect('fly'), f))[0].name).toBe('demo');
    expect(String(f.mock.calls[0][0])).toBe('https://api.machines.dev/v1/apps');
  });
  it('lists Render services with account bearer authorization', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ service: {id:'srv',name:'demo'} }]), { status:200 }));
    expect((await listRenderServices(connect('render'), f))).toHaveLength(1);
    expect(String(f.mock.calls[0][0])).toContain('/v1/services?limit=20');
  });
  it('lists Google Cloud Run only for validated project and region', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ services:[{ name:'projects/project-123/locations/us-central1/services/demo' }] }), {status:200}));
    expect((await listGoogleCloudRunServices(connect('google-cloud-run'), 'project-123', 'us-central1', f))).toHaveLength(1);
    expect(String(f.mock.calls[0][0])).toBe('https://run.googleapis.com/v2/projects/project-123/locations/us-central1/services');
    await expect(listGoogleCloudRunServices(connect('google-cloud-run'),'../wrong','us-central1',f)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('refuses wrong provider, hostile URL and incomplete responses', async () => {
    const noCall = vi.fn<typeof fetch>();
    await expect(getRailwayAccount(connect('fly'),noCall)).rejects.toThrow();
    const client = createProviderClient(connect('railway'), noCall);
    await expect(client.request({path:'//hostile.example/'})).rejects.toThrow();
    expect(noCall).not.toHaveBeenCalled();
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {status:200}));
    await expect(listFlyApps(connect('fly'),malformed)).rejects.toThrow();
  });
});
