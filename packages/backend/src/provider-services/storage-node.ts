/** Node-only unified KrnlTS storage facade, separated from the portable registry. */
import { createService, createServiceDefinition, type IService } from '@ultrst-armada/krnl';
import { createCanonicalStorageService } from './storage/service.js';
import type { StorageServiceConfig } from './storage/service.js';

type Input = { config: StorageServiceConfig; path?: string; cursor?: string };
const definition = createServiceDefinition({
  id: 'kloks.external.storage', name: 'Canonical Storage Provider Service', version: '1.0.0',
  operations: {
    list: { id: 'storage.list', name: 'list',
      handler: (input: Input) => createCanonicalStorageService(input.config).list(input.path, input.cursor) },
    read: { id: 'storage.read', name: 'read',
      handler: (input: Input & { path: string }) =>
        createCanonicalStorageService(input.config).read(input.path) },
    write: { id: 'storage.write', name: 'write',
      handler: (input: Input & { path: string; data: Uint8Array | string; contentType?: string }) =>
        createCanonicalStorageService(input.config).write(input.path,input.data,input.contentType) },
    delete: { id: 'storage.delete', name: 'delete',
      handler: (input: Input & { path: string }) =>
        createCanonicalStorageService(input.config).delete(input.path) },
  },
});
const instance: IService = createService(definition);
export const CanonicalStorageProviderService = {
  id: definition.id, name: definition.name, version: definition.version,
  runtime: 'server' as const, deployment: 'local' as const,
  definition, get telemetry() { return instance.telemetry; },
  createInstance: () => createService(definition),
  execute: async <TIn = unknown, TOut = unknown>(operation: string, input: TIn): Promise<TOut> => {
    await instance.start();
    return instance.call<TIn, TOut>(operation, input);
  },
};
