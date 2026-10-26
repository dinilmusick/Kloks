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

function buildMonacoIdeServiceDefinition(getService: () => IService<MonacoState>): ServiceDefinition<MonacoState> {
  return createServiceDefinition<MonacoState>({
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
        getService().setState({ sessions: { ...getService().getState().sessions, [sessionId]: session } });
        return session;
      },
    },
    updateDocument: {
      id: 'MonacoIdeService.updateDocument',
      name: 'updateDocument',
      handler: async (input: MonacoUpdateDocumentInput, ctx) => {
        const current = getService().getState().sessions[input.sessionId];
        if (!current) throw new Error(`Unknown Monaco session: ${input.sessionId}`);
        const document = {
          ...current.document,
          value: input.value,
          language: input.language || current.document.language,
          version: current.document.version + 1,
        };
        const session = { ...current, document, updatedAt: Date.now() };
        getService().setState({ sessions: { ...getService().getState().sessions, [session.sessionId]: session } });
        return session;
      },
    },
    setDiagnostics: {
      id: 'MonacoIdeService.setDiagnostics',
      name: 'setDiagnostics',
      handler: async (input: { sessionId: string; diagnostics: MonacoDiagnostic[] }, ctx) => {
        const current = getService().getState().sessions[input.sessionId];
        if (!current) throw new Error(`Unknown Monaco session: ${input.sessionId}`);
        const session = {
          ...current,
          document: { ...current.document, diagnostics: input.diagnostics },
          updatedAt: Date.now(),
        };
        getService().setState({ sessions: { ...getService().getState().sessions, [session.sessionId]: session } });
        return session;
      },
    },
    setOptions: {
      id: 'MonacoIdeService.setOptions',
      name: 'setOptions',
      handler: async (input: { sessionId: string; options: MonacoEditorOptions }, ctx) => {
        const current = getService().getState().sessions[input.sessionId];
        if (!current) throw new Error(`Unknown Monaco session: ${input.sessionId}`);
        const session = { ...current, options: { ...current.options, ...input.options }, updatedAt: Date.now() };
        getService().setState({ sessions: { ...getService().getState().sessions, [session.sessionId]: session } });
        return session;
      },
    },
    getSession: {
      id: 'MonacoIdeService.getSession',
      name: 'getSession',
      handler: async (input: { sessionId: string }, ctx) => getService().getState().sessions[input.sessionId] || null,
    },
    disposeSession: {
      id: 'MonacoIdeService.disposeSession',
      name: 'disposeSession',
      handler: async (input: { sessionId: string }, ctx) => {
        const sessions = { ...getService().getState().sessions };
        delete sessions[input.sessionId];
        getService().setState({ sessions });
        return { disposed: true, sessionId: input.sessionId };
      },
    },
  },
  });
}

export const MonacoIdeServiceDefinition = buildMonacoIdeServiceDefinition(() => activeMonacoService);
export function createMonacoIdeService(): IService<MonacoState> {
  let instance!: IService<MonacoState>;
  instance = createService(buildMonacoIdeServiceDefinition(() => instance));
  return instance;
}

const defaultMonacoIdeService = createService(MonacoIdeServiceDefinition);
activeMonacoService = defaultMonacoIdeService;
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
