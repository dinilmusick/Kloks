import { describe, expect, it } from 'vitest';
import { MonacoIdeServiceDefinition } from './client-services/monacoIdeService.js';
import { UIAuthoringServiceDefinition, createUIAuthoringService } from './client-services/uiAuthoringService.js';

describe('shared IDE and UI authoring services', () => {
  it('exposes the Monaco session lifecycle', () => {
    expect(Object.keys(MonacoIdeServiceDefinition.operations)).toEqual([
      'createSession', 'updateDocument', 'setDiagnostics', 'setOptions', 'getSession', 'disposeSession',
    ]);
  });

  it('exposes context-neutral UI authoring operations', () => {
    expect(Object.keys(UIAuthoringServiceDefinition.operations)).toEqual([
      'createSession', 'replaceSession', 'addNode', 'updateNode', 'removeNode', 'setBinding',
      'setOperations', 'validate', 'serialize', 'generateArtifact', 'generateServiceUI', 'suggestComponent', 'getSession',
    ]);
  });
});


  it('builds a context-aware artifact and rejects broken hierarchy', async () => {
    const service = createUIAuthoringService();
    await service.start();
    const session = await service.call<unknown, import('@kloks/contracts').UIAuthoringSession>('createSession', {
      context: 'general-component',
      metadata: { origin: 'theta', name: 'ExampleButton' },
    });
    const valid = await service.call<unknown, import('@kloks/contracts').UIAuthoringValidation>('validate', { sessionId: session.sessionId });
    expect(valid.valid).toBe(false);
    await service.call('addNode', { sessionId: session.sessionId, node: {
      id: 'page', kind: 'page', name: 'Page', props: {},
    }});
    await service.call('addNode', { sessionId: session.sessionId, node: {
      id: 'section', kind: 'section', name: 'Section', parentId: 'page', props: {},
    }});
    const validAfterHierarchy = await service.call<unknown, import('@kloks/contracts').UIAuthoringValidation>('validate', { sessionId: session.sessionId });
    expect(validAfterHierarchy.valid).toBe(true);
    const artifact = await service.call<unknown, import('@kloks/contracts').UIComponentArtifact>('generateArtifact', { sessionId: session.sessionId });
    expect(artifact.purpose).toBe('general-purpose');
    expect(artifact.promotion).toBe('always');
  });
