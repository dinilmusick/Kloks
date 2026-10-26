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


it('validates typed operation bindings and resolves nested component roots', async () => {
  const service = createUIAuthoringService();
  await service.start();
  const session = await service.call<unknown, import('@kloks/contracts').UIAuthoringSession>('createSession', {
    context: 'general-component',
    operations: [{
      operationId: 'submit',
      name: 'submit',
      inputFields: [{ name: 'email', type: 'email' }],
      outputFields: [{ name: 'message', type: 'string' }],
    }],
    metadata: { origin: 'theta', name: 'EmailForm', rootComponentId: 'form' },
  });
  const assetRef = {
    packageId: '@ultrst-armada/floks',
    packageVersion: '^1.5.0',
    exportPath: 'ui',
    assetId: 'floks.input.text',
    assetVersion: '1.0.0',
  };
  await service.call('addNode', { sessionId: session.sessionId, node: {
    id: 'page', kind: 'page', name: 'Page', props: {},
  }});
  await service.call('addNode', { sessionId: session.sessionId, node: {
    id: 'section', kind: 'section', name: 'Section', parentId: 'page', props: {},
  }});
  await service.call('addNode', { sessionId: session.sessionId, node: {
    id: 'form', kind: 'component', name: 'EmailInput', parentId: 'section', props: {}, assetRef,
  }});
  await service.call('setBinding', { sessionId: session.sessionId, binding: {
    componentId: 'form',
    property: 'value',
    target: { kind: 'api-input', apiId: 'submit', field: 'email', fieldType: 'email' },
  }});
  const validation = await service.call<unknown, import('@kloks/contracts').UIAuthoringValidation>('validate', { sessionId: session.sessionId });
  expect(validation.valid).toBe(true);
  const artifact = await service.call<unknown, import('@kloks/contracts').UIComponentArtifact>('generateArtifact', { sessionId: session.sessionId });
  expect(artifact.rootAsset).toEqual(assetRef);
});

it('rejects bindings to structural nodes and unknown operation fields', async () => {
  const service = createUIAuthoringService();
  await service.start();
  const session = await service.call<unknown, import('@kloks/contracts').UIAuthoringSession>('createSession', {
    context: 'general-component',
    operations: [{ operationId: 'submit', name: 'submit', inputFields: [{ name: 'email', type: 'email' }] }],
  });
  await service.call('addNode', { sessionId: session.sessionId, node: {
    id: 'page', kind: 'page', name: 'Page', props: {},
  }});
  await service.call('setBinding', { sessionId: session.sessionId, binding: {
    componentId: 'page',
    property: 'value',
    target: { kind: 'api-input', apiId: 'submit', field: 'missing', fieldType: 'email' },
  }});
  const validation = await service.call<unknown, import('@kloks/contracts').UIAuthoringValidation>('validate', { sessionId: session.sessionId });
  expect(validation.valid).toBe(false);
  expect(validation.errors).toContain('Binding target must be a component node: page');
  expect(validation.errors).toContain('Binding references missing input field: submit.missing');
});
