import { describe, expect, it } from 'vitest';
import { TypeScriptLanguageServerServiceDefinition } from './typescriptLanguageServerService.js';

describe('TypeScriptLanguageServerService', () => {
  it('exposes a Krnl service contract', () => {
    expect(TypeScriptLanguageServerServiceDefinition.id).toBe('kloks.backend.typescriptLanguageServer');
    expect(TypeScriptLanguageServerServiceDefinition.operations).toEqual(
      expect.objectContaining({
        start: expect.any(Object),
        request: expect.any(Object),
        notify: expect.any(Object),
        stop: expect.any(Object),
        status: expect.any(Object),
      }),
    );
  });
});
