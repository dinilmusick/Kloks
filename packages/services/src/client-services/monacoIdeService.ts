import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';
import type {
  MonacoCreateSessionInput,
  MonacoDiagnostic,
  MonacoEditorOptions,
  MonacoIdeSession,
  MonacoUpdateDocumentInput,
} from '@kloks/contracts';

let activeMonacoService: IService<MonacoState>;

interface MonacoState extends Record<string, unknown> {
  sessions: Record<string, MonacoIdeSession>;
}

export const MonacoIdeServiceDefinition: ServiceDefinition<MonacoState> = createServiceDefinition({
  id: 'kloks.service.monacoIde',
  name: 'MonacoIdeService',
  version: '1.0.0',
  state: { initial: { sessions: {} } },
  operations: {
    createSession: {
      id: 'MonacoIdeService.createSession',
      name: 'createSession',
      handler: async (input: MonacoCreateSessionInput, ctx) => {
        const sessionId = input.sessionId || `monaco-${Date.now().toString(36)}`;
        const now = Date.now();
        const session: MonacoIdeSession = {
          sessionId,
          document: { uri: input.uri, language: input.language, value: input.value, version: 1, diagnostics: [] },
          options: input.options || {},
          createdAt: now,
          updatedAt: now,
        };
        activeMonacoService.setState({ sessions: { ...activeMonacoService.getState().sessions, [sessionId]: session } });
        return session;
      },
    },
    updateDocument: {
      id: 'MonacoIdeService.updateDocument',
      name: 'updateDocument',
      handler: async (input: MonacoUpdateDocumentInput, ctx) => {
        const current = activeMonacoService.getState().sessions[input.sessionId];
        if (!current) throw new Error(`Unknown Monaco session: ${input.sessionId}`);
        const document = {
          ...current.document,
          value: input.value,
          language: input.language || current.document.language,
          version: current.document.version + 1,
        };
        const session = { ...current, document, updatedAt: Date.now() };
        activeMonacoService.setState({ sessions: { ...activeMonacoService.getState().sessions, [session.sessionId]: session } });
        return session;
      },
    },
    setDiagnostics: {
      id: 'MonacoIdeService.setDiagnostics',
      name: 'setDiagnostics',
      handler: async (input: { sessionId: string; diagnostics: MonacoDiagnostic[] }, ctx) => {
        const current = activeMonacoService.getState().sessions[input.sessionId];
        if (!current) throw new Error(`Unknown Monaco session: ${input.sessionId}`);
        const session = {
          ...current,
          document: { ...current.document, diagnostics: input.diagnostics },
          updatedAt: Date.now(),
        };
        activeMonacoService.setState({ sessions: { ...activeMonacoService.getState().sessions, [session.sessionId]: session } });
        return session;
      },
    },
    setOptions: {
      id: 'MonacoIdeService.setOptions',
      name: 'setOptions',
      handler: async (input: { sessionId: string; options: MonacoEditorOptions }, ctx) => {
        const current = activeMonacoService.getState().sessions[input.sessionId];
        if (!current) throw new Error(`Unknown Monaco session: ${input.sessionId}`);
        const session = { ...current, options: { ...current.options, ...input.options }, updatedAt: Date.now() };
        activeMonacoService.setState({ sessions: { ...activeMonacoService.getState().sessions, [session.sessionId]: session } });
        return session;
      },
    },
    getSession: {
      id: 'MonacoIdeService.getSession',
      name: 'getSession',
      handler: async (input: { sessionId: string }, ctx) => activeMonacoService.getState().sessions[input.sessionId] || null,
    },
    disposeSession: {
      id: 'MonacoIdeService.disposeSession',
      name: 'disposeSession',
      handler: async (input: { sessionId: string }, ctx) => {
        const sessions = { ...activeMonacoService.getState().sessions };
        delete sessions[input.sessionId];
        activeMonacoService.setState({ sessions });
        return { disposed: true, sessionId: input.sessionId };
      },
    },
  },
});

export function createMonacoIdeService(): IService<MonacoState> {
  activeMonacoService = createService(MonacoIdeServiceDefinition);
  return activeMonacoService;
}

const defaultMonacoIdeService = createMonacoIdeService();
export const MonacoIdeServiceFacade = {
  id: MonacoIdeServiceDefinition.id,
  name: MonacoIdeServiceDefinition.name,
  version: MonacoIdeServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: MonacoIdeServiceDefinition,
  service: defaultMonacoIdeService,
  createInstance: createMonacoIdeService,
  execute: async <TIn = unknown, TOut = unknown>(operation: string, input?: TIn) => {
    await defaultMonacoIdeService.start();
    return defaultMonacoIdeService.call<TIn, TOut>(operation, input);
  },
};
