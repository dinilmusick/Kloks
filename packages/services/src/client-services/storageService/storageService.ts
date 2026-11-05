import {
  UserStorageConnection,
  AdminDatabaseClusterConfig,
  DatabaseConnectionEntry,
} from '@kloks/state-graph';
import { authService } from '../authService';
import { systemDbService } from '../systemDbService';
import { createSrklAccountClient, DEFAULT_SRKL_API_URL, type SrklAccount } from '../srklAccountService.js';
import {
  CLEAN_DATABASE_CLUSTER,
} from './helpers';
import { StorageServiceUISchema } from './storage.ui.js';
import type { ServiceUISchema } from '@kloks/contracts';

type StorageListener = () => void;

class StorageService {
  static readonly ui: ServiceUISchema = StorageServiceUISchema;
  readonly ui: ServiceUISchema = StorageServiceUISchema;

  private connections: UserStorageConnection[] = [];
  private clusterConfig: AdminDatabaseClusterConfig = CLEAN_DATABASE_CLUSTER;
  private listeners: Set<StorageListener> = new Set();

  constructor() {
    authService.subscribe((state) => {
      if (state.isAuthenticated) void this.loadState();
      else {
        this.connections = [];
        this.notify();
      }
    });
    void authService.refreshSession().catch(() => undefined);
  }

  private async createSrklClient() {
    const state = authService.getState();
    if (!state.isAuthenticated || !state.currentUser) throw new Error("A verified Luth session is required.");
    const token = authService.getAuthToken() || undefined;
    return createSrklAccountClient({
      baseUrl: DEFAULT_SRKL_API_URL,
      userId: state.currentUser.id,
      appId: "kloks",
      token: token ? `Bearer ${token}` : undefined,
      sessionToken: token,
    });
  }

  private mapSrklAccount(account: SrklAccount): UserStorageConnection {
    const credentials = account.credentials || {};
    const metadata = account.metadata || {};
    return {
      ...metadata,
      ...credentials,
      id: account.id,
      srklAccountId: account.id,
      name: account.name,
      label: account.name,
      provider: account.provider === "backblaze" ? "backblaze_b2" : account.provider,
      role: metadata.role === "primary" ? "primary" : "redundant_clone",
      b2KeyId: credentials.keyId || credentials.b2KeyId || credentials.accessKeyId,
      b2ApplicationKey: credentials.applicationKey || credentials.b2ApplicationKey || credentials.secretAccessKey,
      b2BucketName: credentials.bucketName || credentials.b2BucketName,
      b2BucketId: credentials.bucketId || credentials.b2BucketId,
      b2Endpoint: credentials.endpoint || credentials.b2Endpoint,
      b2Region: credentials.region || credentials.b2Region,
      credentials,
      source: "SRKL",
    } as unknown as UserStorageConnection;
  }

  private async loadState() {
    try {
      const client = await this.createSrklClient();
      const result = await client.list({ categories: ["storage"], includeCredentials: false });
      this.connections = (result.accounts || []).map((account) => this.mapSrklAccount(account));
    } catch {
      this.connections = [];
    }
    this.notify();
  }

  subscribe(listener: StorageListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  getConnections(): UserStorageConnection[] {
    return [...this.connections];
  }

  getConnectionById(id?: string): UserStorageConnection | undefined {
    if (!id) return undefined;
    return this.connections.find((c) => c.id === id);
  }

  getPrimaryConnection(): UserStorageConnection | undefined {
    return this.connections.find((c) => c.role === 'primary') || this.connections[0];
  }

  getStorageLocationInfo(ws: {
    id?: string;
    name?: string;
    storageProvider?: string;
    storageConnectionId?: string;
    localFolderName?: string;
    workspacePath?: string;
    b2BucketName?: string;
    b2Endpoint?: string;
    b2Region?: string;
  }): {
    provider: string;
    providerLabel: string;
    displayLabel: string;
    targetUrl: string | null;
    localPath: string;
    bucketName?: string;
    isLocal: boolean;
    isCloud: boolean;
    connection?: UserStorageConnection;
  } {
    const conn = ws.storageConnectionId ? this.getConnectionById(ws.storageConnectionId) : this.getPrimaryConnection();
    const provider = ws.storageProvider || conn?.provider || 'local_fs';
    const isLocal = provider === 'local_fs';
    const isCloud = !isLocal;
    const wsId = ws.id || 'default';
    const folderName = ws.localFolderName || conn?.localFolderName || ws.name || 'Depm-Vault';
    const localPath = `data/workspaces/${wsId}`;

    if (provider === 'backblaze_b2') {
      const bucket = ws.b2BucketName || conn?.b2BucketName || 'ultrst-apps';
      const endpoint = ws.b2Endpoint || conn?.b2Endpoint || 's3.eu-central-003.backblazeb2.com';
      // Direct Backblaze bucket / file browse URL
      const targetUrl = `https://secure.backblaze.com/b2_browse_files.htm?bucketName=${encodeURIComponent(bucket)}`;
      return {
        provider: 'backblaze_b2',
        providerLabel: 'Backblaze B2',
        displayLabel: `B2 Bucket: ${bucket}`,
        targetUrl,
        localPath,
        bucketName: bucket,
        isLocal: false,
        isCloud: true,
        connection: conn,
      };
    }

    if (provider === 'cloudflare_r2') {
      const bucket = conn?.r2BucketName || 'depm-node-graphs';
      return {
        provider: 'cloudflare_r2',
        providerLabel: 'Cloudflare R2',
        displayLabel: `R2 Bucket: ${bucket}`,
        targetUrl: 'https://dash.cloudflare.com/',
        localPath,
        bucketName: bucket,
        isLocal: false,
        isCloud: true,
        connection: conn,
      };
    }

    if (provider === 'aws_s3') {
      const bucket = conn?.s3BucketName || 'depm-node-graphs';
      const region = conn?.s3Region || 'us-east-1';
      return {
        provider: 'aws_s3',
        providerLabel: 'AWS S3',
        displayLabel: `S3 Bucket: ${bucket}`,
        targetUrl: `https://s3.console.aws.amazon.com/s3/buckets/${bucket}?region=${region}&prefix=${wsId}/`,
        localPath,
        bucketName: bucket,
        isLocal: false,
        isCloud: true,
        connection: conn,
      };
    }

    if (provider === 'supabase_storage') {
      const bucket = conn?.supabaseBucketName || 'depm-graphs';
      const baseUrl = conn?.supabaseUrl ? conn.supabaseUrl.replace(/\/+$/, '') : 'https://supabase.com/dashboard';
      return {
        provider: 'supabase_storage',
        providerLabel: 'Supabase Storage',
        displayLabel: `Supabase Bucket: ${bucket}`,
        targetUrl: `${baseUrl}/storage/buckets/${bucket}`,
        localPath,
        bucketName: bucket,
        isLocal: false,
        isCloud: true,
        connection: conn,
      };
    }

    // Default: local_fs
    return {
      provider: 'local_fs',
      providerLabel: 'Local Folder',
      displayLabel: `Local Vault: ${folderName}`,
      targetUrl: null,
      localPath,
      isLocal: true,
      isCloud: false,
      connection: conn,
    };
  }


  saveConnection(_conn: UserStorageConnection): UserStorageConnection {
    throw new Error("Storage provider accounts are managed in SRKL. Update credentials in the SRKL account manager.");
  }

  setPrimaryConnection(_id: string): never {
    throw new Error("Primary storage provider selection is managed by SRKL.");
  }

  deleteConnection(_id: string): never {
    throw new Error("Storage provider accounts must be removed in SRKL.");
  }

  async testConnection(conn: UserStorageConnection): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const startedAt = Date.now();
    try {
      const client = await this.createSrklClient();
      const remote = await client.getByService((conn as any).serviceId || (conn.provider === 'backblaze_b2' ? 'backblaze' : conn.provider), { forceSync: true });
      if (!remote) return { success: false, latencyMs: Date.now() - startedAt, error: "Storage account is not available in SRKL." };
      const connection = this.mapSrklAccount(remote);
      const response = await fetch('/api/storage/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection }),
      });
      const data = await response.json();
      const latencyMs = data.latencyMs || Date.now() - startedAt;
      const match = this.connections.find((item) => item.id === conn.id);
      if (match) {
        match.testedAt = new Date().toISOString();
        match.testStatus = data.success ? 'ok' : 'failed';
        match.latencyMs = latencyMs;
        this.notify();
      }
      return data.success
        ? { success: true, latencyMs }
        : { success: false, latencyMs, error: data.error || 'Connection probe failed' };
    } catch (error) {
      return { success: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Storage probe connection failed' };
    }
  }

  getClusterConfig(): AdminDatabaseClusterConfig {
    return systemDbService.getCluster();
  }

  addDatabaseEntry(entry: Omit<DatabaseConnectionEntry, 'id'>): DatabaseConnectionEntry {
    const newEntry: DatabaseConnectionEntry = {
      ...entry,
      id: `db_${entry.engine}_${Date.now()}`,
      status: 'connected',
      latencyMs: Math.round(15 + Math.random() * 30),
      recordsCloned: 24,
      lastSyncedAt: new Date().toISOString(),
    };
    systemDbService.addDatabase(newEntry);
    return newEntry;
  }

  updateDatabaseEntry(id: string, updates: Partial<DatabaseConnectionEntry>) {
    if (updates.role === 'primary') {
      systemDbService.setPrimaryDatabase(id);
    }
  }

  deleteDatabaseEntry(id: string) {
    systemDbService.deleteDatabase(id);
  }

  async syncRedundancyCluster(): Promise<{ success: boolean; message: string }> {
    return systemDbService.syncRedundancy();
  }
}

export const storageService = new StorageService();
export { StorageService };
