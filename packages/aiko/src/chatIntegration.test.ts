import { describe, expect, it } from 'vitest';
import { createAikoChatIntegration, type AuthorizedAgentAddress } from './chatIntegration.js';

const agents: AuthorizedAgentAddress[] = [
  { id: 'app', appId: 'a', kind: 'app', name: 'Aiko App', canonicalName: 'Aiko App' },
  { id: 'endpoint', appId: 'b', kind: 'endpoint', name: 'Stock', canonicalName: 'Stock', alias: 'stocks' },
  { id: 'flow', appId: 'b', kind: 'workflow', name: 'Report', canonicalName: 'Report', alias: 'report' },
];
const user = { userId: 'u', appId: 'a', workspaceId: 'w' };
function setup(patch: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let allowed = true;
  let child: ((target: { appId: string; agentId: string }, input: unknown) => Promise<unknown>) | null = null;
  const integration = createAikoChatIntegration({
    verifyCaller: s => s === 'valid' ? user : null,
    listAuthorized: () => agents,
    authorizeOperation: () => allowed,
    executeAuthorized: async (entry, input, ctx, signal, invokeChild) => {
      if (signal.aborted) throw new Error('aborted');
      calls.push(entry.id);
      child = invokeChild;
      if (entry.id === 'app') return { status: 'completed', output: await invokeChild({ appId: 'b', agentId: 'endpoint' }, input) };
      return { status: 'completed', output: { id: entry.id, caller: ctx.caller.agentId ?? 'user', input } };
    },
    ...patch,
  });
  return { integration, calls, revoke: () => { allowed = false; }, child: () => child };
}

describe('Aiko authenticated chat integration', () => {
  it('routes user -> app -> endpoint -> app -> user, preserving immediate caller', async () => {
    const { integration, calls } = setup();
    const reply = await integration.chat('valid', 'show stock');
    expect(calls).toEqual(['app', 'endpoint']);
    expect(reply.replyTo).toEqual(user);
    const nested = (reply.result as any).output;
    expect(nested.replyTo).toMatchObject({ userId: 'u', appId: 'a', workspaceId: 'w', agentId: 'app' });
    expect(nested.result.output.caller).toBe('app');
    expect(reply.traceId).toBe(nested.traceId);
    expect(reply.callId).not.toBe(nested.callId);
  });
  it('directly mentioned workflow returns to the verified user', async () => {
    const { integration, calls } = setup();
    const reply = await integration.chat('valid', '@report make chart');
    expect(calls).toEqual(['flow']);
    expect(reply.replyTo).toEqual(user);
    expect(reply.result).toMatchObject({ status: 'completed', output: { id: 'flow', caller: 'user' } });
  });
  it('raw graph invocation shares authorization and execution adapters', async () => {
    const { integration, calls } = setup();
    await integration.invoke('valid', { appId: 'b', agentId: 'endpoint' }, { ticker: 'A' });
    expect(calls).toEqual(['endpoint']);
  });
  it('rejects invalid sessions, unknown and ambiguous aliases', async () => {
    const { integration } = setup();
    await expect(integration.chat('forged', '@report hello')).rejects.toThrow('authenticated');
    await expect(integration.chat('valid', '@missing hello')).rejects.toThrow('Unknown or ambiguous');
    const duplicated = setup({ listAuthorized: () => [...agents,
      { id: 'other', appId: 'c', kind: 'workflow', name: 'Report', canonicalName: 'Report', alias: 'report' }] });
    await expect(duplicated.integration.chat('valid', '@report hello')).rejects.toThrow('ambiguous');
  });
  it('reauthorizes each hop and rejects cycles, late child contexts and revocation', async () => {
    const { integration, revoke, calls } = setup();
    revoke();
    await expect(integration.chat('valid', 'hello')).rejects.toThrow('not authorized');
    expect(calls).toEqual([]);
    const cyc = setup({ executeAuthorized: async (_entry: unknown, _input: unknown, _ctx: unknown,
      _sig: unknown, call: (target: {appId:string;agentId:string}, input: unknown) => Promise<unknown>) => {
      await call({ appId: 'b', agentId: 'endpoint' }, {});
      return { status: 'completed', output: true };
    } });
    await expect(cyc.integration.chat('valid', '@stocks hello')).rejects.toThrow('Cyclic');
  });
  it('returns typed missing input without executing the target', async () => {
    const { integration, calls } = setup({ validateInput: (entry: AuthorizedAgentAddress, input: unknown) =>
      entry.kind === 'workflow' && input === 'incomplete'
        ? [{ name: 'date', question: 'Which date?' }] : [] });
    const reply = await integration.chat('valid', '@report incomplete');
    expect(reply.result).toEqual({ status: 'needs_input', question: 'Which date?', issues: ['date'] });
    expect(calls).toEqual([]);
  });
  it('isolates concurrent caller traces and rejects nested cross-app recursion', async () => {
    const { integration } = setup();
    const [a,b] = await Promise.all([integration.chat('valid', 'one'),integration.chat('valid','two')]);
    expect(a.traceId).not.toBe(b.traceId);
    const cyc = setup({ executeAuthorized: async (entry: AuthorizedAgentAddress, _input: unknown, _ctx: unknown,
      _signal: unknown, child: (target:{appId:string;agentId:string}, input:unknown)=>Promise<unknown>) => {
      if (entry.appId === 'a') return { status:'completed', output: await child({ appId:'b', agentId:'endpoint' }, {}) };
      await child({ appId:'a', agentId:'app' }, {});
      return { status:'completed', output: 'unreachable' };
    } });
    await expect(cyc.integration.chat('valid', 'test')).rejects.toThrow('Cyclic cross-app');
  });
});
