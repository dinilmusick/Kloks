/**
 * @file modelCatalog.ts
 * @description Master Model Catalog Service for AI model registration and retrieval
 */

import type { ProviderId } from '../ai-provider/types.js';
import type { ModelCatalogEntry } from './types.js';
import { STATIC_MODELS_CATALOG } from './catalogData.js';
import { modelHealthService } from './modelHealthService.js';

export class ModelCatalogService {
  private providerStatuses: Record<string, { providerId: ProviderId; status: string; modelsCount: number; error?: string }> = {};
  private customModels: Map<string, ModelCatalogEntry> = new Map();

  getCatalog(providerId?: ProviderId): ModelCatalogEntry[] {
    return providerId ? this.getAllModels().filter((model) => model.providerId === providerId) : this.getAllModels();
  }

  getProviderStatuses(): Array<{ providerId: ProviderId; status: string; modelsCount: number; error?: string }> {
    const providers = new Set(this.getAllModels().map((model) => model.providerId));
    for (const providerId of providers) {
      const modelsCount = this.getModelsByProvider(providerId).length;
      this.providerStatuses[providerId] ??= { providerId, status: 'online', modelsCount };
      this.providerStatuses[providerId].modelsCount = modelsCount;
    }
    return Object.values(this.providerStatuses);
  }

  async refreshCatalogFromEndpoints(): Promise<{ updated: number; errors: string[] }> {
    return { updated: 0, errors: [] };
  }

  getAllModels(): ModelCatalogEntry[] {
    const list = [...STATIC_MODELS_CATALOG, ...Array.from(this.customModels.values())];
    return list;
  }

  getModelsByProvider(providerId: ProviderId): ModelCatalogEntry[] {
    return this.getAllModels().filter((m) => m.providerId === providerId);
  }

  getModelById(id: string): ModelCatalogEntry | undefined {
    return this.getModel(id);
  }

  recordModelSuccess(id: string): void {
    const model = this.getModel(id);
    if (model) model.status = 'active';
  }

  recordModelFailure(id: string): void {
    const model = this.getModel(id);
    if (model) model.status = 'offline';
  }

  createExecutionContract(
    modelId: string,
    providerId: ProviderId,
    keyId: string,
    intelligenceSpec?: unknown
  ): { contractId: string } {
    return {
      contractId: `contract-${Date.now()}-${providerId}-${modelId}-${keyId}`,
    };
  }

  getModel(id: string): ModelCatalogEntry | undefined {
    return (
      this.customModels.get(id) ??
      this.getAllModels().find((m) => m.id === id || m.id.endsWith(id))
    );
  }

  registerModel(model: ModelCatalogEntry): void {
    this.customModels.set(model.id, model);
  }

  getAvailableModels(): ModelCatalogEntry[] {
    return this.getAllModels().filter((m) =>
      modelHealthService.isModelAvailable(m.providerId, m.id)
    );
  }
}

export const modelCatalog = new ModelCatalogService();
