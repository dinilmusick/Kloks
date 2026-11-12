import { getGoogleSdk } from './googleDriveSdk.js';
import { Readable } from 'node:stream';
import { BaseStorageAdapter } from './BaseStorageAdapter.js';
import type { GoogleDriveFolder, FileInfo, StorageConfig, ConnectionTestResult } from './types.js';
import type { GoogleDriveRuntimeAuthOptions, GoogleDriveTokenSet } from './GoogleDriveOAuth.js';

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string | number;
  modifiedTime?: string;
  parents?: string[];
};

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

function toTokenSet(credentials: Record<string, any>, fallback?: GoogleDriveTokenSet): GoogleDriveTokenSet | undefined {
  const accessToken = credentials.access_token || fallback?.accessToken;
  if (!accessToken) return undefined;
  return {
    accessToken,
    ...(credentials.refresh_token || fallback?.refreshToken
      ? { refreshToken: credentials.refresh_token || fallback?.refreshToken }
      : {}),
    ...(credentials.expiry_date || fallback?.expiresAt
      ? { expiresAt: credentials.expiry_date || fallback?.expiresAt }
      : {}),
    ...(credentials.token_type || fallback?.tokenType
      ? { tokenType: credentials.token_type || fallback?.tokenType }
      : {}),
  };
}

export class GoogleDriveAdapter extends BaseStorageAdapter {
  private client?: any;
  private auth?: any;
  private authPromise?: Promise<any>;
  private pendingCredentialPersistence?: Promise<void>;
  private credentialPersistenceError?: Error;
  private readonly runtimeAuth: GoogleDriveRuntimeAuthOptions;

  constructor(config: StorageConfig, runtimeAuth: GoogleDriveRuntimeAuthOptions = {}) {
    super({ ...config, provider: 'google_drive' });
    this.runtimeAuth = runtimeAuth;
  }

  private async getAuth(): Promise<any> {
    if (this.auth) return this.auth;
    if (this.authPromise) return this.authPromise;

    this.authPromise = (async () => {
      const google = await getGoogleSdk();
      const client = new google.auth.OAuth2(
        this.config.googleClientId,
        this.runtimeAuth.clientSecret,
        this.config.googleRedirectUri,
      );

      const supplied = this.runtimeAuth.getCredentials
        ? await this.runtimeAuth.getCredentials()
        : undefined;
      const credentials = supplied ?? {
        accessToken: this.config.googleAccessToken,
        refreshToken: this.config.googleRefreshToken,
        expiresAt: this.config.googleAccessTokenExpiresAt,
      };

      if (!credentials.accessToken && !credentials.refreshToken) {
        throw new Error('Google Drive OAuth credentials are incomplete. Reauthorize the Google account.');
      }

      client.setCredentials({
        ...(credentials.accessToken ? { access_token: credentials.accessToken } : {}),
        ...(credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {}),
        ...(credentials.expiresAt ? { expiry_date: credentials.expiresAt } : {}),
        ...(credentials.tokenType ? { token_type: credentials.tokenType } : {}),
      });

      client.on('tokens', (tokens: any) => {
        const next = toTokenSet({ ...(client.credentials as Record<string, any>), ...tokens }, credentials);
        if (!next) return;
        this.config.googleAccessToken = next.accessToken;
        if (next.refreshToken) this.config.googleRefreshToken = next.refreshToken;
        if (next.expiresAt) this.config.googleAccessTokenExpiresAt = next.expiresAt;
        if (!this.runtimeAuth.persistCredentials) return;
        // Track persistence so storage operations do not silently outlive a failed credential write.
        this.pendingCredentialPersistence = Promise.resolve(this.runtimeAuth.persistCredentials(next)).then(
          () => undefined,
          () => { this.credentialPersistenceError = new Error('Google Drive credentials could not be persisted securely.'); },
        );
      });

      this.auth = client;
      return client;
    })();

    try {
      return await this.authPromise;
    } catch (error) {
      this.authPromise = undefined;
      throw error;
    }
  }

  private async getClient(): Promise<any> {
    if (this.client) {
      if (this.pendingCredentialPersistence) await this.pendingCredentialPersistence;
      if (this.credentialPersistenceError) throw this.credentialPersistenceError;
      return this.client;
    }

    const google = await getGoogleSdk();
    const auth = await this.getAuth();
    const token = await auth.getAccessToken();
    if (this.pendingCredentialPersistence) await this.pendingCredentialPersistence;
    if (this.credentialPersistenceError) throw this.credentialPersistenceError;
    if (!token.token) {
      throw new Error('Google Drive authorization returned no access token. Reauthorize the Google account.');
    }

    this.config.googleAccessToken = token.token;
    if (auth.credentials.expiry_date) {
      this.config.googleAccessTokenExpiresAt = auth.credentials.expiry_date;
    }
    if (auth.credentials.refresh_token) {
      this.config.googleRefreshToken = auth.credentials.refresh_token;
    }

    this.client = google.drive({ version: 'v3', auth });
    return this.client;
  }

  private async findChild(parentId: string, name: string): Promise<DriveFile | null> {
    const drive = await this.getClient();
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const response = await drive.files.list({
      q: `'${parentId}' in parents and name = '${escapedName}' and trashed = false`,
      fields: 'files(id,name,size,modifiedTime,mimeType,parents)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return response.data.files?.[0] || null;
  }

  private async resolveParent(relativeDir: string, create = false): Promise<string> {
    let parent = this.config.googleRootFolderId || 'root';

    for (const part of this.normalizePath(relativeDir).split('/').filter(Boolean)) {
      let child = await this.findChild(parent, part);

      if (!child && create) {
        const drive = await this.getClient();
        const response = await drive.files.create({
          requestBody: {
            name: part,
            mimeType: FOLDER_MIME_TYPE,
            parents: [parent],
          },
          fields: 'id,name,mimeType,parents,modifiedTime',
          supportsAllDrives: true,
        });
        child = response.data;
      }

      if (!child?.id || child.mimeType !== FOLDER_MIME_TYPE) {
        throw new Error(`Google Drive directory not found: ${part}`);
      }

      parent = child.id;
    }

    return parent;
  }

  private split(pathStr: string): { dir: string; name: string } {
    const key = this.normalizePath(pathStr);
    const i = key.lastIndexOf('/');
    return i < 0 ? { dir: '', name: key } : { dir: key.slice(0, i), name: key.slice(i + 1) };
  }

  /**
   * Return only non-secret connection metadata for persistence alongside the
   * authenticated application user's storage connection record.
   */
  getConnectionMetadata(): Pick<StorageConfig,
    'provider' | 'googleClientId' | 'googleRedirectUri' | 'googleAccountId' | 'googleRootFolderId'
  > {
    return {
      provider: 'google_drive',
      ...(this.config.googleClientId ? { googleClientId: this.config.googleClientId } : {}),
      ...(this.config.googleRedirectUri ? { googleRedirectUri: this.config.googleRedirectUri } : {}),
      ...(this.config.googleAccountId ? { googleAccountId: this.config.googleAccountId } : {}),
      ...(this.config.googleRootFolderId ? { googleRootFolderId: this.config.googleRootFolderId } : {}),
    };
  }

  /** Browse only folders directly below the supplied parent (or selected storage root). */
  async listFolders(parentFolderId = this.config.googleRootFolderId || 'root'): Promise<GoogleDriveFolder[]> {
    const drive = await this.getClient();
    const folders: GoogleDriveFolder[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,parents,modifiedTime)',
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const folder of (response.data.files || []) as DriveFile[]) {
        if (!folder.id || !folder.name) continue;
        folders.push({
          id: folder.id,
          name: folder.name,
          mimeType: FOLDER_MIME_TYPE,
          parentIds: folder.parents || [],
          modifiedAt: folder.modifiedTime ? Date.parse(folder.modifiedTime) : 0,
        });
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return folders;
  }

  /** Resolve and validate a provider-native folder ID before it is saved as a root. */
  async resolveFolder(folderId: string): Promise<GoogleDriveFolder> {
    if (!folderId?.trim()) throw new Error('A Google Drive folder ID is required.');
    const drive = await this.getClient();
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,parents,modifiedTime',
      supportsAllDrives: true,
    });
    const folder = response.data as DriveFile;
    if (!folder.id || !folder.name || folder.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error('The selected Google Drive item is not a folder.');
    }
    return {
      id: folder.id,
      name: folder.name,
      mimeType: FOLDER_MIME_TYPE,
      parentIds: folder.parents || [],
      modifiedAt: folder.modifiedTime ? Date.parse(folder.modifiedTime) : 0,
    };
  }

  /** Select a validated folder as this connection's storage/workspace root. */
  async selectRootFolder(folderId: string): Promise<GoogleDriveFolder> {
    const folder = await this.resolveFolder(folderId);
    this.config.googleRootFolderId = folder.id;
    return folder;
  }

  async read(pathStr: string): Promise<Uint8Array> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file?.id) throw new Error(`Google Drive file not found: ${pathStr}`);
    if (file.mimeType === FOLDER_MIME_TYPE) throw new Error(`Google Drive path is a folder, not a file: ${pathStr}`);

    const drive = await this.getClient();
    const response = await drive.files.get(
      { fileId: file.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return new Uint8Array(response.data as ArrayBuffer);
  }

  async write(
    pathStr: string,
    data: Uint8Array | string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const { dir, name } = this.split(pathStr);
    if (!name) throw new Error('A Google Drive file name is required.');
    const parent = await this.resolveParent(dir, true);
    const existing = await this.findChild(parent, name);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const drive = await this.getClient();

    if (existing?.id) {
      if (existing.mimeType === FOLDER_MIME_TYPE) throw new Error(`Google Drive path is a folder: ${pathStr}`);
      await drive.files.update({
        fileId: existing.id,
        requestBody: { name, mimeType: contentType },
        media: { mimeType: contentType, body: Readable.from(bytes) },
        fields: 'id',
        supportsAllDrives: true,
      });
      return;
    }

    await drive.files.create({
      requestBody: { name, mimeType: contentType, parents: [parent] },
      media: { mimeType: contentType, body: Readable.from(bytes) },
      fields: 'id',
      supportsAllDrives: true,
    });
  }

  async delete(pathStr: string): Promise<void> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file?.id) return;

    const drive = await this.getClient();
    try {
      await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
    } catch (error: any) {
      if (error?.response?.status !== 404 && error?.code !== 404) throw error;
    }
  }

  async exists(pathStr: string): Promise<boolean> {
    try {
      await this.stat(pathStr);
      return true;
    } catch (error: any) {
      if (error?.response?.status === 404 || error?.code === 404) return false;
      throw error;
    }
  }

  async list(pathStr = ''): Promise<FileInfo[]> {
    const parent = await this.resolveParent(pathStr);
    const drive = await this.getClient();
    const results: FileInfo[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${parent}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,size,modifiedTime,mimeType)',
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const file of (response.data.files || []) as DriveFile[]) {
        if (!file.name) continue;
        results.push({
          path: this.normalizePath(pathStr ? `${pathStr}/${file.name}` : file.name),
          size: Number(file.size || 0),
          modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
          ...(file.id ? { id: file.id } : {}),
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
          isFolder: file.mimeType === FOLDER_MIME_TYPE,
        });
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return results;
  }

  async stat(pathStr: string): Promise<FileInfo> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file?.id) throw new Error(`Google Drive file not found: ${pathStr}`);

    return {
      path: pathStr,
      size: Number(file.size || 0),
      modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
      id: file.id,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      isFolder: file.mimeType === FOLDER_MIME_TYPE,
    };
  }

  async mkdir(pathStr: string): Promise<void> {
    await this.resolveParent(pathStr, true);
  }

  /** Resolve the stable Google account identity for association with the app user's server-side connection record. */
  async getAccountIdentity(): Promise<{ accountId: string; email?: string }> {
    const drive = await this.getClient();
    const response = await drive.about.get({ fields: 'user(permissionId,emailAddress)' });
    const accountId = response.data.user?.permissionId || response.data.user?.emailAddress;
    if (!accountId) throw new Error('Google Drive did not return an account identity.');
    if (this.config.googleAccountId && this.config.googleAccountId !== accountId) {
      throw new Error('Google Drive account identity does not match the saved storage connection.');
    }
    this.config.googleAccountId = accountId;
    return {
      accountId,
      ...(response.data.user?.emailAddress ? { email: response.data.user.emailAddress } : {}),
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = performance.now();

    try {
      const identity = await this.getAccountIdentity();
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        details: {
          accountId: identity.accountId,
          ...(identity.email ? { email: identity.email } : {}),
          rootFolderId: this.config.googleRootFolderId || 'root',
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        error: error?.message || 'Google Drive authorization failed.',
      };
    }
  }
}
