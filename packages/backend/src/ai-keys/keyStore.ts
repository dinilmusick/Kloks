/**
 * @file keyStore.ts
 * @description Key Store and Rotation service supporting multiple strategies
 */

import type { ProviderId } from '../ai-provider/types.js';
import type { ApiKeyEntry, RotationStrategy } from './types.js';
import { keysStorage } from './keysStorage.js';
import { validateApiKey } from './keyValidator.js';

export class KeyStoreService {
  private strategy: RotationStrategy = 'lowest-latency';
  private roundRobinIndices: Map<string, number> = new Map();

  getKeys(providerId?: ProviderId): ApiKeyEntry[] {
    const all = keysStorage.loadKeys();
    if (!providerId) return all;
    return all.filter((k) => k.providerId === providerId);
  }

  getKey(id: string): ApiKeyEntry | undefined {
    return keysStorage.loadKeys().find((k) => k.id === id);
  }

  getActiveKey(providerId: ProviderId): ApiKeyEntry | undefined {
    const valid = this.getKeys(providerId).filter(
      (k) => k.isActive && (k.status === 'active' || k.status === 'valid')
    );
    if (valid.length === 0) return undefined;

    if (this.strategy === 'lowest-latency') {
      return [...valid].sort((a, b) => a.lastLatencyMs - b.lastLatencyMs)[0];
    }

    if (this.strategy === 'round-robin') {
      const idx = this.roundRobinIndices.get(providerId) ?? 0;
      const nextIdx = (idx + 1) % valid.length;
      this.roundRobinIndices.set(providerId, nextIdx);
      return valid[idx % valid.length];
    }

    if (this.strategy === 'failover-priority') {
      return [...valid].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))[0];
    }

    return valid[0];
  }

  setStrategy(strategy: RotationStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): RotationStrategy {
    return this.strategy;
  }

  addKey(entry: Partial<ApiKeyEntry> & Pick<ApiKeyEntry, 'providerId' | 'label' | 'key'>): ApiKeyEntry {
    const full: ApiKeyEntry = {
      id: `key_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date().toISOString(),
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      lastLatencyMs: 0,
      errorCount: 0,
      status: 'active',
      isActive: true,
      remainingCreditsUsd: null,
      weight: 5,
      ...entry,
    };
    keysStorage.saveKey(full);
    return full;
  }

  getPermanentKey(providerId: ProviderId): string | null {
    return null;
  }

  getPermanentKeysMap(): Record<string, string> {
    return {};
  }

  setPermanentKey(_providerId: ProviderId, _keyId: string | null): void {}

  setForcedNextKey(providerId: ProviderId, keyId: string): void {
    this.roundRobinIndices.set(providerId, -1);
    const key = this.getKey(keyId);
    if (key) key.lastLatencyMs = -1;
  }

  peekNextKey(providerId: ProviderId, modelId?: string): ApiKeyEntry | null {
    return this.selectNextKey(providerId, modelId) ?? null;
  }

  getNextKey(providerId: ProviderId, modelId?: string): ApiKeyEntry | null {
    return this.peekNextKey(providerId, modelId);
  }

  selectNextKey(providerId: ProviderId, _modelId?: string): ApiKeyEntry | undefined {
    return this.getActiveKey(providerId);
  }

  updateKeyLabel(id: string, label: string): ApiKeyEntry | undefined {
    const key = this.getKey(id);
    if (!key) return undefined;
    key.label = label;
    keysStorage.saveKey(key);
    return key;
  }

  deleteKey(id: string): boolean {
    const existed = Boolean(this.getKey(id));
    keysStorage.deleteKey(id);
    return existed;
  }

  resetKeyProbabilities(id: string): ApiKeyEntry | undefined {
    const key = this.getKey(id);
    if (!key) return undefined;
    key.weight = 5;
    key.errorCount = 0;
    key.status = 'active';
    key.isActive = true;
    keysStorage.saveKey(key);
    return key;
  }

  resetAllFailures(): void {
    for (const key of this.getKeys()) {
      key.errorCount = 0;
      key.status = 'active';
      key.isActive = true;
      keysStorage.saveKey(key);
    }
  }

  getUsageStats(_keyId?: string, _modelId?: string): KeyModelUsageStats[] {
    return [];
  }

  updateKeyStatus(id: string, status: ApiKeyEntry['status']): void {
    const key = this.getKey(id);
    if (!key) return;
    key.status = status;
    keysStorage.saveKey(key);
  }

  recordUsage(
    keyId: string,
    successOrLatency: boolean | number,
    latencyOrSuccess: boolean | number,
    _costUsd = 0,
    _modelId?: string,
    error?: string
  ): void {
    const key = this.getKey(keyId);
    if (!key) return;
    const success = typeof successOrLatency === 'boolean' ? successOrLatency : Boolean(latencyOrSuccess);
    const latencyMs = typeof successOrLatency === 'number' ? successOrLatency : Number(latencyOrSuccess);
    key.totalCalls++;
    key.lastLatencyMs = latencyMs;
    key.lastUsedAt = new Date().toISOString();
    if (success) key.successfulCalls++;
    else {
      key.failedCalls++;
      key.errorCount++;
      key.validationError = error ?? key.validationError;
    }
    keysStorage.saveKey(key);
  }

  exportKeysStructured(): { version: 1; exportedAt: string; keys: ApiKeyEntry[] } {
    return { version: 1, exportedAt: new Date().toISOString(), keys: this.getKeys() };
  }

  async importKeys(payload: unknown): Promise<{ importedCount: number; keys: ApiKeyEntry[] }> {
    const raw = (payload as any)?.keys ?? payload;
    if (!Array.isArray(raw)) throw new Error('Invalid key backup payload.');
    const keys = raw.filter((entry): entry is ApiKeyEntry =>
      Boolean(entry && typeof entry.id === 'string' && typeof entry.providerId === 'string' && typeof entry.key === 'string')
    );
    keysStorage.saveKeys(keys);
    return { importedCount: keys.length, keys };
  }

  async verifyKey(id: string): Promise<boolean> {
    const entry = this.getKey(id);
    if (!entry) return false;

    const res = await validateApiKey(entry.providerId, entry.key);
    entry.status = res.status;
    entry.lastLatencyMs = res.latencyMs;
    entry.validationError = res.error;
    keysStorage.saveKey(entry);
    return res.valid;
  }
}

export const keyStore = new KeyStoreService();
