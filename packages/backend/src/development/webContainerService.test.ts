import { describe, expect, it } from 'vitest';
import { WebContainerServiceDefinition } from './webContainerService.js';

describe('WebContainerService', () => {
  it('exposes the complete canonical lifecycle and generic execution surface', () => {
    expect(Object.keys(WebContainerServiceDefinition.operations)).toEqual([
      'boot', 'mount', 'run', 'runCommand', 'teardown', 'command',
    ]);
  });

  it('keeps deterministic development command aliases', async () => {
    const operation = WebContainerServiceDefinition.operations.command as any;
    expect(await operation.handler({ task: 'test' })).toEqual({ task: 'test', command: { command: 'pnpm', args: ['test'] } });
    expect(await operation.handler({ task: 'build' })).toEqual({ task: 'build', command: { command: 'pnpm', args: ['build'] } });
  });
});
