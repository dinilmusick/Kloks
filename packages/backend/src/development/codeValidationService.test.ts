import { describe, expect, it } from 'vitest';
import { CodeValidationRuntime } from './codeValidationService.js';

describe('CodeValidationRuntime', () => {
  it('runs framework validation layers in order and stops on failure', async () => {
    const calls: string[] = [];
    const fake = {
      runCommand: async (command: string, args: string[]) => {
        calls.push([command, ...args].join(' '));
        return { exitCode: command === 'pnpm' && args.includes('frnl') ? 1 : 0, output: '' };
      },
    };
    const result = await new CodeValidationRuntime(fake as any).validate({ layers: ['syntax', 'krnl', 'frnl', 'build'] });
    expect(result.ok).toBe(false);
    expect(result.failedLayers).toEqual(['frnl']);
    expect(calls).toEqual([
      'pnpm exec tsc --noEmit',
      'pnpm exec krnl validate',
      'pnpm exec frnl validate',
    ]);
  });
});
