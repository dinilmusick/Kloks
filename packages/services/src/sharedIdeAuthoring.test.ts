import { describe, expect, it } from 'vitest';
import { MonacoIdeServiceDefinition } from './client-services/monacoIdeService.js';
import { UIAuthoringServiceDefinition } from './client-services/uiAuthoringService.js';

describe('shared IDE and UI authoring services', () => {
  it('exposes the Monaco session lifecycle', () => {
    expect(Object.keys(MonacoIdeServiceDefinition.operations)).toEqual([
      'createSession', 'updateDocument', 'setDiagnostics', 'setOptions', 'getSession', 'disposeSession',
    ]);
  });

  it('exposes context-neutral UI authoring operations', () => {
    expect(Object.keys(UIAuthoringServiceDefinition.operations)).toEqual([
      'createSession', 'replaceSession', 'addNode', 'updateNode', 'removeNode', 'setBinding',
      'setOperations', 'validate', 'serialize', 'generateServiceUI', 'suggestComponent', 'getSession',
    ]);
  });
});
