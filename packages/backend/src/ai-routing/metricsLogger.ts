/**
 * @file metricsLogger.ts
 * @description Latency, throughput, and token usage metrics logger for AI operations
 */

import type { ProviderId } from '../ai-provider/types.js';

export interface AIMetricRecord {
  id: string;
  timestamp: string;
  providerId: ProviderId;
  modelId: string;
  durationMs: number;
  success: boolean;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
}

export class MetricsLogger {
  private records: AIMetricRecord[] = [];
  private readonly maxRecords: number = 2000;

  log(record: Omit<AIMetricRecord, 'id' | 'timestamp'>): void {
    const full: AIMetricRecord = {
      id: `met_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.records.push(full);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  getRecent(limit: number = 50): AIMetricRecord[] {
    return this.records.slice(-limit);
  }

  getAverageLatency(providerId: ProviderId, modelId?: string): number {
    const matches = this.records.filter(
      (r) => r.providerId === providerId && (modelId ? r.modelId === modelId : true) && r.success
    );
    if (matches.length === 0) return 0;
    const sum = matches.reduce((acc, r) => acc + r.durationMs, 0);
    return Math.round(sum / matches.length);
  }

  getSuccessRate(providerId: ProviderId): number {
    const matches = this.records.filter((r) => r.providerId === providerId);
    if (matches.length === 0) return 100;
    const successes = matches.filter((r) => r.success).length;
    return Math.round((successes / matches.length) * 100);
  }
}

export const metricsLogger = new MetricsLogger();
