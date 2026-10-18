/**
 * @file krnl-services.ts
 * @description First-class KrnlTS ServiceDefinitions and ServiceFacades for @kloks/backend:
 * - AuthServiceFacade
 * - StorageServiceFacade
 * - WorkspaceServiceFacade
 * - ControlPlaneServiceFacade
 */

import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';
import { SessionManager } from './auth/SessionManager.js';
import { RateLimiter } from './auth/RateLimiter.js';
import type { UserRole } from './auth/types.js';
import { StorageAdapterFactory } from './storage/StorageAdapterFactory.js';
import {
  formatCanonicalWorkspaceFolderName,
  sanitizeWorkspaceName,
} from './workspace/WorkspaceCanonical.js';

// 1. AuthService (KrnlTS Service)
export const AuthServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.auth',
  name: 'AuthService',
  version: '1.0.0',
  state: {
    initial: { activeSessions: 0 },
  },
  operations: {
    createSession: {
      id: 'AuthService.createSession',
      name: 'createSession',
      handler: async (input: { userId: string; role?: UserRole }) => {
        const sm = new SessionManager();
        return sm.createSession(input.userId, input.role ?? 'user');
      },
    },
    checkRateLimit: {
      id: 'AuthService.checkRateLimit',
      name: 'checkRateLimit',
      handler: async (input: { key: string; maxRequests?: number; windowMs?: number }) => {
        const limiter = new RateLimiter(input.windowMs ?? 60000, input.maxRequests ?? 60);
        limiter.check(input.key);
        return { allowed: true, key: input.key };
      },
    },
  },
});

const authServiceInstance: IService = createService(AuthServiceDefinition);

export const AuthServiceFacade = {
  id: AuthServiceDefinition.id,
  name: AuthServiceDefinition.name,
  version: AuthServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'local' as const,
  definition: AuthServiceDefinition,
  createInstance: () => createService(AuthServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await authServiceInstance.start(); return authServiceInstance.call<TIn, TOut>(op, input); },
};

// 2. StorageService (KrnlTS Service)
export const StorageServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.storage',
  name: 'StorageService',
  version: '1.0.0',
  operations: {
    resolveAdapterType: {
      id: 'StorageService.resolveAdapterType',
      name: 'resolveAdapterType',
      handler: async (input: { provider: 'local' | 'local_fs' | 's3' | 'b2' | 'supabase'; basePath?: string }) => {
        const normalized = input.provider === 'local' ? 'local_fs' : input.provider;
        if (normalized === 'local_fs') {
          const adapter = StorageAdapterFactory.create({
            provider: 'local_fs',
            basePath: input.basePath ?? '/tmp/kloks-storage',
          });
          return { provider: 'local', initialized: Boolean(adapter) };
        }
        return { provider: input.provider, initialized: true };
      },
    },
  },
});

const storageServiceInstance: IService = createService(StorageServiceDefinition);

export const StorageServiceFacade = {
  id: StorageServiceDefinition.id,
  name: StorageServiceDefinition.name,
  version: StorageServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'local' as const,
  definition: StorageServiceDefinition,
  createInstance: () => createService(StorageServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await storageServiceInstance.start(); return storageServiceInstance.call<TIn, TOut>(op, input); },
};

// 3. WorkspaceService (KrnlTS Service)
export const WorkspaceServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.workspace',
  name: 'WorkspaceService',
  version: '1.0.0',
  operations: {
    validateWorkspaceConfig: {
      id: 'WorkspaceService.validateWorkspaceConfig',
      name: 'validateWorkspaceConfig',
      handler: async (input: { id: string; name: string; storageType?: string; appName?: string; userName?: string }) => {
        const sanitized = sanitizeWorkspaceName(input.name);
        const folderName = formatCanonicalWorkspaceFolderName(
          input.appName ?? 'app',
          input.userName ?? 'user',
          sanitized
        );
        return {
          valid: Boolean(input.id && sanitized),
          workspaceId: input.id,
          name: sanitized,
          folderName,
          storageType: input.storageType ?? 'local',
        };
      },
    },
  },
});

const workspaceServiceInstance: IService = createService(WorkspaceServiceDefinition);

export const WorkspaceServiceFacade = {
  id: WorkspaceServiceDefinition.id,
  name: WorkspaceServiceDefinition.name,
  version: WorkspaceServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'local' as const,
  definition: WorkspaceServiceDefinition,
  createInstance: () => createService(WorkspaceServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await workspaceServiceInstance.start(); return workspaceServiceInstance.call<TIn, TOut>(op, input); },
};

// 4. ControlPlaneService (KrnlTS Service)
export const ControlPlaneServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.controlPlane',
  name: 'ControlPlaneService',
  version: '1.0.0',
  operations: {
    status: {
      id: 'ControlPlaneService.status',
      name: 'status',
      handler: async () => ({
        healthy: true,
        timestamp: Date.now(),
      }),
    },
  },
});

const controlPlaneServiceInstance: IService = createService(ControlPlaneServiceDefinition);

export const ControlPlaneServiceFacade = {
  id: ControlPlaneServiceDefinition.id,
  name: ControlPlaneServiceDefinition.name,
  version: ControlPlaneServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'local' as const,
  definition: ControlPlaneServiceDefinition,
  createInstance: () => createService(ControlPlaneServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await controlPlaneServiceInstance.start(); return controlPlaneServiceInstance.call<TIn, TOut>(op, input); },
};

// 5. DatabaseService (KrnlTS Service)
export const DatabaseServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.database',
  name: 'DatabaseService',
  version: '1.0.0',
  operations: {
    query: {
      id: 'DatabaseService.query',
      name: 'query',
      handler: async (input: { sql: string; params?: unknown[] }) => {
        return { rows: [], sql: input.sql, executedAt: Date.now() };
      },
    },
    isHealthy: {
      id: 'DatabaseService.isHealthy',
      name: 'isHealthy',
      handler: async () => ({ healthy: true }),
    },
  },
});

const databaseServiceInstance: IService = createService(DatabaseServiceDefinition);

export const DatabaseServiceFacade = {
  id: DatabaseServiceDefinition.id,
  name: DatabaseServiceDefinition.name,
  version: DatabaseServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'local' as const,
  definition: DatabaseServiceDefinition,
  createInstance: () => createService(DatabaseServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await databaseServiceInstance.start(); return databaseServiceInstance.call<TIn, TOut>(op, input); },
};

// 7. GeminiService (KrnlTS Service)
export const GeminiServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.gemini',
  name: 'GeminiService',
  version: '1.0.0',
  operations: {
    generateText: {
      id: 'GeminiService.generateText',
      name: 'generateText',
      handler: async (input: { prompt: string; model?: string }) => {
        return { text: `[GeminiResponse] Generated response for: ${input.prompt}`, model: input.model ?? 'gemini-2.5-flash', timestamp: Date.now() };
      },
    },
  },
});

const geminiServiceInstance: IService = createService(GeminiServiceDefinition);

export const GeminiServiceFacade = {
  id: GeminiServiceDefinition.id,
  name: GeminiServiceDefinition.name,
  version: GeminiServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'remote' as const,
  definition: GeminiServiceDefinition,
  createInstance: () => createService(GeminiServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => { await geminiServiceInstance.start(); return geminiServiceInstance.call<TIn, TOut>(op, input); },
};

