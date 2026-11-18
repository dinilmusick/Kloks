import { describe, expect, it } from 'vitest';
import { ImmediateCallerRouter, type ChatCallContext, type ChatResult } from './callerRouting.js';

const alice = { userId: 'alice', appId: 'aiko', workspaceId: 'w-alice', sessionId: 'session-a' };
const bob = { userId: 'bob', appId: 'aiko', workspaceId: 'w-bob', sessionId: 'session-b' };
const target = { appId: 'kone', agentId: 'endpoint-1' };

function router(overrides: Partial<ConstructorParameters<typeof ImmediateCallerRouter>[0]> = {}) {
  return new ImmediateCallerRouter({
    verifyCaller: session => session === 'session-a' ? alice : session === 'session-b' ? bob : null,
    authorize: (caller, _target, context) =>
      caller.userId === 'alice' && caller.workspaceId === 'w-alice' && context.traceId.length > 0,
    dispatch: async (_target, input) => ({ status: 'completed', output: input }),
    ...overrides,
  });
}

describe('ImmediateCallerRouter', () => {
  it('binds a direct user reply to the verified session, not a caller-supplied address', async () => {
    const result = await router().call('session-a', target, { replyTo: 'bob', input: 42 });
    expect(result.result).toEqual({ status: 'completed', output: { replyTo: 'bob', input: 42 } });
    expect(result.replyTo).toEqual(alice);
    expect(result.callId).toBeTruthy();
    expect(result.traceId).toBeTruthy();
    await expect(router().call({ userId: 'alice', workspaceId: 'w-alice' }, target, {}))
      .rejects.toThrow('authenticated caller');
  });

  it('returns delegated clarifications to the immediate calling agent', async () => {
    const observed: Array<{ caller: string; target: string; depth: number }> = [];
    let innerReply: Awaited<ReturnType<ImmediateCallerRouter['call']>> | undefined;
    let runtime!: ImmediateCallerRouter;
    runtime = router({
      dispatch: async (selected, _input, ctx) => {
        observed.push({ caller: ctx.caller.agentId ?? 'user', target: selected.agentId, depth: ctx.depth });
        if (ctx.depth === 0) {
          innerReply = await runtime.callChild(ctx, { appId: 'srkl', agentId: 'workflow-agent' }, {});
          return { status: 'completed', output: innerReply.result };
        }
        return { status: 'needs_input', question: 'Which storage account?' };
      },
    });
    const response = await runtime.call('session-a', target, {});
    expect(observed).toEqual([
      { caller: 'user', target: 'endpoint-1', depth: 0 },
      { caller: 'endpoint-1', target: 'workflow-agent', depth: 1 },
    ]);
    expect(innerReply?.replyTo).toMatchObject({ userId: 'alice', workspaceId: 'w-alice', appId: 'kone', agentId: 'endpoint-1' });
    expect(innerReply?.result).toEqual({ status: 'needs_input', question: 'Which storage account?' });
    expect(response.replyTo).toEqual(alice);
    expect(response.result).toEqual({ status: 'completed', output: innerReply?.result });
    expect(innerReply?.traceId).toBe(response.traceId);
    expect(innerReply?.callId).not.toBe(response.callId);
  });

  it('does not route concurrent requests between users or workspaces', async () => {
    const runtime = router({
      authorize: (caller, _target, context) => caller.workspaceId === 'w-' + caller.userId && context.target.appId === 'kone',
      dispatch: async (_t, _i, ctx) => {
        await Promise.resolve();
        return { status: 'completed', output: ctx.caller.userId };
      },
    });
    const [a, b] = await Promise.all([
      runtime.call('session-a', target, {}),
      runtime.call('session-b', target, {}),
    ]);
    expect(a.replyTo.userId).toBe('alice');
    expect(b.replyTo.userId).toBe('bob');
    expect(a.result).toEqual({ status: 'completed', output: 'alice' });
    expect(b.result).toEqual({ status: 'completed', output: 'bob' });
    expect(a.traceId).not.toBe(b.traceId);
  });

  it('rechecks grants on nested hops and rejects revocation', async () => {
    let approvals = 0;
    let runtime!: ImmediateCallerRouter;
    runtime = router({
      authorize: () => ++approvals === 1,
      dispatch: async (_t, _i, ctx) => {
        await runtime.callChild(ctx, { appId: 'srkl', agentId: 'nested' }, {});
        return { status: 'completed', output: true };
      },
    });
    await expect(runtime.call('session-a', target, {})).rejects.toThrow('not authorized');
    expect(approvals).toBe(2);
  });

  it('blocks cross-app returns, while permitting legitimate same-app nesting', async () => {
    let runtime!: ImmediateCallerRouter;
    runtime = router({
      dispatch: async (_t, _i, ctx) => {
        if (ctx.depth === 0) {
          await expect(runtime.callChild(ctx, { appId: 'aiko', agentId: 'loop' }, {}))
            .rejects.toThrow('Cyclic cross-app');
          return runtime.callChild(ctx, { appId: 'kone', agentId: 'same-app' }, {});
        }
        return { status: 'completed', output: ctx.target.agentId };
      },
    });
    const result = await runtime.call('session-a', target, {});
    expect((result.result as Extract<ChatResult, { status: 'completed' }>).output)
      .toMatchObject({ result: { status: 'completed', output: 'same-app' } });
  });

  it('rejects forged or reused parent contexts', async () => {
    const rt = router();
    await expect(rt.callChild({ callId: 'forged' } as ChatCallContext, target, {}))
      .rejects.toThrow('active trusted parent');
    let saved!: ChatCallContext;
    const activeRouter = router({
      dispatch: async (_t, _i, ctx) => { saved = ctx; return { status: 'completed', output: true }; },
    });
    await activeRouter.call('session-a', target, {});
    await expect(activeRouter.callChild(saved, target, {})).rejects.toThrow('active trusted parent');
  });

  it('enforces shared trace call and depth budgets, including sibling calls', async () => {
    let runtime!: ImmediateCallerRouter;
    runtime = router({
      maxCalls: 2,
      maxDepth: 1,
      dispatch: async (_t, _i, ctx) => {
        if (ctx.depth === 0) {
          await runtime.callChild(ctx, { appId: 'kone', agentId: 'child' }, {});
          await expect(runtime.callChild(ctx, { appId: 'kone', agentId: 'sibling' }, {}))
            .rejects.toThrow('call budget');
        }
        return { status: 'completed', output: ctx.depth };
      },
    });
    await expect(runtime.call('session-a', target, {})).resolves.toMatchObject({ result: { output: 0 } });
  });

  it('cancels a pending target at its deadline and rejects malformed clarification', async () => {
    let aborted = false;
    const rt = router({
      timeoutMs: 10,
      dispatch: async (_target, _input, _ctx, signal) => await new Promise<ChatResult>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve({ status: 'completed', output: 'late' });
        }, { once: true });
      }),
    });
    await expect(rt.call('session-a', target, {})).rejects.toThrow('deadline');
    expect(aborted).toBe(true);
    const malformed = router({
      dispatch: async () => ({ status: 'needs_input', question: '' }),
    });
    await expect(malformed.call('session-a', target, {})).rejects.toThrow('clarification question');
  });
});
