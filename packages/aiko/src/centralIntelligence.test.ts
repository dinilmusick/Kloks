import { expect, it, vi } from 'vitest';
import { createCentralAikoIntelligenceResolver } from './centralIntelligence.js';

const id = 'logic';
const document = (version: string, reasoning: number) => ({
  schemaVersion: 1,
  specId: id,
  version: version.repeat(64),
  spec: { reasoning },
  routingPolicy: { prioritiseReasoning: true, prioritiseDeterminism: true, avoidPaidProviders: false },
});

it('reads the current version independently for two apps and fails closed after revocation', async () => {
  let state = document('a', 9);
  const revoked = new Set<string>();
  const send = vi.fn<typeof fetch>(async (url, options) => {
    expect(String(url)).toBe('https://aiko.test/api/v1/workspaces/workspace-1/intelligence-specs/logic');
    expect(options?.redirect).toBe('error');
    expect(options?.cache).toBe('no-store');
    const auth = new Headers(options?.headers).get('authorization') ?? '';
    return revoked.has(auth) ? new Response(null, { status: 403 }) : Response.json(state);
  });
  const make = (luthSession: string) => createCentralAikoIntelligenceResolver({
    origin: 'https://aiko.test', send, scope: async () => ({ workspaceId: 'workspace-1', luthSession }),
  });
  const appA = make('session-a');
  const appB = make('session-b');
  const read = async () => Promise.all([appA.resolve(id), appB.resolve(id)]);
  await expect(read()).resolves.toEqual([state, state]);
  state = document('b', 4);
  await expect(read()).resolves.toEqual([state, state]);
  revoked.add('Bearer session-b');
  await expect(appB.resolve(id)).rejects.toThrow('access was denied');
  await expect(appA.resolve(id)).resolves.toEqual(state);
});

it('rejects malformed routing data and requires a scoped session before contacting Aiko', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ ...document('a', 4), spec: { reasoning: '4' } }));
  const origin = 'https://aiko.test';
  const empty = createCentralAikoIntelligenceResolver({ origin, send, scope: async () => null });
  await expect(empty.resolve(id)).rejects.toThrow('verified Luth session');
  expect(send).not.toHaveBeenCalled();
  const scoped = createCentralAikoIntelligenceResolver({
    origin, send, scope: async () => ({ workspaceId: 'workspace-1', luthSession: 'session' }),
  });
  await expect(scoped.resolve(id)).rejects.toThrow('invalid IntelligenceSpec');
});
