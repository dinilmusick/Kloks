/**
 * Canonical SRKL account client used by ecosystem applications.
 * SRKL is authoritative; applications explicitly synchronize into local state.
 */
export type EcosystemServiceCategory =
  | 'deployment' | 'storage' | 'vcs' | 'ai' | 'database' | 'general';

export interface SrklAccount {
  id: string;
  serviceId: string;
  provider: string;
  category: EcosystemServiceCategory;
  name: string;
  emailOrSlug?: string;
  status: string;
  credentials?: Record<string, unknown>;
  groupIds?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SrklAccountManifest {
  appId?: string;
  appName?: string;
  categories?: EcosystemServiceCategory[];
  requiredServices?: string[];
}

export interface SrklAccountClientOptions {
  baseUrl: string;
  userId: string;
  appId: string;
  fetchImpl?: typeof fetch;
}

export interface SrklAccountSyncResult {
  success: boolean;
  count: number;
  accounts: SrklAccount[];
  workspaceId: string;
}

export class SrklAccountClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly userId: string;
  private readonly appId: string;

  constructor(options: SrklAccountClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.userId = options.userId;
    this.appId = options.appId;
  }

  async sync(manifest: SrklAccountManifest = {}): Promise<SrklAccountSyncResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/ecosystem/accounts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': this.userId,
        'x-app-id': this.appId,
      },
      body: JSON.stringify({ ...manifest, appId: manifest.appId || this.appId }),
    });
    if (!response.ok) throw new Error(`SRKL account sync failed: ${response.status}`);
    return response.json() as Promise<SrklAccountSyncResult>;
  }

  async list(manifest: SrklAccountManifest = {}): Promise<SrklAccountSyncResult> {
    return this.sync(manifest);
  }

  async getByService(serviceId: string): Promise<SrklAccount | undefined> {
    const result = await this.sync({ requiredServices: [serviceId] });
    return result.accounts.find((account) =>
      account.serviceId.toLowerCase() === serviceId.toLowerCase() ||
      account.provider.toLowerCase() === serviceId.toLowerCase()
    );
  }
}

export function createSrklAccountClient(options: SrklAccountClientOptions): SrklAccountClient {
  return new SrklAccountClient(options);
}

export function mergeSrklAccounts<T extends { srklAccountId?: string; id?: string }>(
  local: T[],
  remote: SrklAccount[],
): T[] {
  const remoteIds = new Set(remote.map((account) => account.id));
  const byRemoteId = new Map(local.filter((item) => item.srklAccountId).map((item) => [item.srklAccountId!, item]));
  const merged = remote.map((account) => ({
    ...(byRemoteId.get(account.id) || {}),
    ...account,
    srklAccountId: account.id,
    syncedAt: new Date().toISOString(),
    source: 'SRKL' as const,
  })) as unknown as T[];

  // Preserve unrelated local records; synchronized SRKL records are replaced above.
  for (const item of local) {
    if (item.srklAccountId && remoteIds.has(item.srklAccountId)) continue;
    if (!item.srklAccountId) merged.push(item);
  }
  return merged;
}
