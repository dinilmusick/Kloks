import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';
import type {
  UIAuthoringBinding,
  UIAuthoringCreateInput,
  UIAuthoringNode,
  UIAuthoringOperation,
  UIAuthoringSession,
  UIAuthoringValidation,
} from '@kloks/contracts';
import { buildServiceUISchema, suggestUIComponent } from '@kloks/contracts';

let activeUIAuthoringService: IService<UIAuthoringState>;

interface UIAuthoringState extends Record<string, unknown> {
  sessions: Record<string, UIAuthoringSession>;
}

export const UIAuthoringServiceDefinition: ServiceDefinition<UIAuthoringState> = createServiceDefinition({
  id: 'kloks.service.uiAuthoring',
  name: 'UIAuthoringService',
  version: '1.0.0',
  state: { initial: { sessions: {} } },
  operations: {
    createSession: {
      id: 'UIAuthoringService.createSession',
      name: 'createSession',
      handler: async (input: UIAuthoringCreateInput, ctx) => {
        const sessionId = input.sessionId || `ui-authoring-${Date.now().toString(36)}`;
        const session: UIAuthoringSession = {
          sessionId,
          context: input.context,
          nodes: [],
          bindings: [],
          operations: input.operations || [],
          metadata: input.metadata || {},
        };
        activeMonacoService.setState({ sessions: { ...activeMonacoService.getState().sessions, [sessionId]: session } });
        return session;
      },
    },
    addNode: {
      id: 'UIAuthoringService.addNode',
      name: 'addNode',
      handler: async (input: { sessionId: string; node: UIAuthoringNode }, ctx) => updateSession(ctx.service, input.sessionId, (session) => ({
        ...session, nodes: [...session.nodes.filter((node) => node.id !== input.node.id), input.node],
      })),
    },
    updateNode: {
      id: 'UIAuthoringService.updateNode',
      name: 'updateNode',
      handler: async (input: { sessionId: string; nodeId: string; patch: Partial<UIAuthoringNode> }, ctx) => updateSession(ctx.service, input.sessionId, (session) => ({
        ...session, nodes: session.nodes.map((node) => node.id === input.nodeId ? { ...node, ...input.patch } : node),
      })),
    },
    removeNode: {
      id: 'UIAuthoringService.removeNode',
      name: 'removeNode',
      handler: async (input: { sessionId: string; nodeId: string }, ctx) => updateSession(ctx.service, input.sessionId, (session) => ({
        ...session,
        nodes: session.nodes.filter((node) => node.id !== input.nodeId && node.parentId !== input.nodeId),
      })),
    },
    setBinding: {
      id: 'UIAuthoringService.setBinding',
      name: 'setBinding',
      handler: async (input: { sessionId: string; binding: UIAuthoringBinding }, ctx) => updateSession(ctx.service, input.sessionId, (session) => ({
        ...session,
        bindings: [...session.bindings.filter((binding) => binding.componentId !== input.binding.componentId || binding.property !== input.binding.property), input.binding],
      })),
    },
    setOperations: {
      id: 'UIAuthoringService.setOperations',
      name: 'setOperations',
      handler: async (input: { sessionId: string; operations: UIAuthoringOperation[] }, ctx) => updateSession(ctx.service, input.sessionId, (session) => ({ ...session, operations: input.operations })),
    },
    validate: {
      id: 'UIAuthoringService.validate',
      name: 'validate',
      handler: async (input: { sessionId: string }, ctx) => validateSession(getSession(ctx.service, input.sessionId)),
    },
    serialize: {
      id: 'UIAuthoringService.serialize',
      name: 'serialize',
      handler: async (input: { sessionId: string }, ctx) => JSON.stringify(getSession(ctx.service, input.sessionId), null, 2),
    },
    generateServiceUI: {
      id: 'UIAuthoringService.generateServiceUI',
      name: 'generateServiceUI',
      handler: async (input: { sessionId: string }, ctx) => buildServiceUISchema(getSession(ctx.service, input.sessionId)),
    },
    suggestComponent: {
      id: 'UIAuthoringService.suggestComponent',
      name: 'suggestComponent',
      handler: async (input: { fieldType: string }) => suggestUIComponent(input.fieldType),
    },
    getSession: {
      id: 'UIAuthoringService.getSession',
      name: 'getSession',
      handler: async (input: { sessionId: string }, ctx) => activeMonacoService.getState().sessions[input.sessionId] || null,
    },
  },
});

function getSession(service: IService<UIAuthoringState>, sessionId: string): UIAuthoringSession {
  const session = service.getState().sessions[sessionId];
  if (!session) throw new Error(`Unknown UI authoring session: ${sessionId}`);
  return session;
}

function updateSession(
  service: IService<UIAuthoringState>,
  sessionId: string,
  update: (session: UIAuthoringSession) => UIAuthoringSession
): UIAuthoringSession {
  const session = update(getSession(service, sessionId));
  service.setState({ sessions: { ...service.getState().sessions, [sessionId]: session } });
  return session;
}

function validateSession(session: UIAuthoringSession): UIAuthoringValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!session.nodes.some((node) => node.kind === 'page')) errors.push('At least one page is required.');
  if (session.nodes.some((node) => node.kind === 'component' && !node.assetRef)) errors.push('Every component node requires a FLOKS asset reference.');
  if (session.context === 'service' && !session.metadata.serviceId) errors.push('Service authoring requires metadata.serviceId.');
  for (const binding of session.bindings) {
    if (!session.nodes.some((node) => node.id === binding.componentId)) errors.push(`Binding references missing component: ${binding.componentId}`);
  }
  if (!session.operations.length) warnings.push('No service operations have been attached to this authoring session.');
  return { valid: errors.length === 0, errors, warnings };
}

export function createUIAuthoringService(): IService<UIAuthoringState> {
  activeUIAuthoringService = createService(UIAuthoringServiceDefinition);
  return activeUIAuthoringService;
}

const defaultUIAuthoringService = createUIAuthoringService();
export const UIAuthoringServiceFacade = {
  id: UIAuthoringServiceDefinition.id,
  name: UIAuthoringServiceDefinition.name,
  version: UIAuthoringServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: UIAuthoringServiceDefinition,
  service: defaultUIAuthoringService,
  createInstance: createUIAuthoringService,
  execute: async <TIn = unknown, TOut = unknown>(operation: string, input?: TIn) => {
    await defaultUIAuthoringService.start();
    return defaultUIAuthoringService.call<TIn, TOut>(operation, input);
  },
};
