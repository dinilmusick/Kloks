/**
 * @file healthCheckService.ts
 * @description Periodic and on-demand route and provider health verification
 */

import type { ProviderId } from '../ai-provider/types.js';
import { aiProviderService } from '../ai-provider/AIProviderService.js';
import { modelHealthService } from '../ai-models/modelHealthService.js';

export class HealthCheckService {
  async checkProvider(providerId: ProviderId, apiKey?: string): Promise<boolean> {
    const status = await aiProviderService.checkHealth(providerId, apiKey);
    return status.isOnline;
  }

  isRouteAvailable(providerId: ProviderId, modelId: string): boolean {
    return modelHealthService.isModelAvailable(providerId, modelId);
  }

  recordRouteFailure(providerId: ProviderId, modelId: string, error: string): void {
    modelHealthService.recordFailure(providerId, modelId, error);
  }

  recordRouteSuccess(providerId: ProviderId, modelId: string, latencyMs: number): void {
    modelHealthService.recordSuccess(providerId, modelId, latencyMs);
  }
}

export const healthCheckService = new HealthCheckService();
