import { describe, expect, it, vi } from 'vitest';
import { DevelopmentRuntime, resolveDevelopmentCommand } from './developmentService.js';
import type { DevelopmentRequest } from './types.js';

describe('DevelopmentService', () => {
  it('maps every canonical task to a deterministic pnpm command', () => {
    expect(resolveDevelopmentCommand('install')).toEqual(['pnpm', ['install', '--no-frozen-lockfile']]);
    expect(resolveDevelopmentCommand('lint')).toEqual(['pnpm', ['lint']]);
    expect(resolveDevelopmentCommand('test')).toEqual(['pnpm', ['test']]);
    expect(resolveDevelopmentCommand('build')).toEqual(['pnpm', ['build']]);
    expect(resolveDevelopmentCommand('validate')).toEqual(['pnpm', ['validate']]);
  });

  it('dispatches GitHub Actions through the common provider path', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const github = { dispatchWorkflow: dispatch } as any;
    const web = { run: vi.fn() } as any;
    const runtime = new DevelopmentRuntime(web, github);
    const request: DevelopmentRequest = {
      provider: 'github-actions',
      task: 'test',
      repository: 'dinilmusick/Krusbl-Engine',
      workflowId: 'development.yml',
      ref: 'main',
      workflowInputs: { mode: 'strict' },
    };
    const result = await runtime.run(request);
    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      'dinilmusick/Krusbl-Engine',
      'development.yml',
      'main',
      { task: 'test', mode: 'strict' },
    );
    expect(web.run).not.toHaveBeenCalled();
  });

  it('uses WebContainer for local execution and returns its exit status', async () => {
    const web = { run: vi.fn().mockResolvedValue({ exitCode: 0, output: 'PASS' }) } as any;
    const runtime = new DevelopmentRuntime(web);
    const result = await runtime.run({ provider: 'webcontainer', task: 'test' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('PASS');
    expect(web.run).toHaveBeenCalledWith('test', undefined, undefined);
  });
});
