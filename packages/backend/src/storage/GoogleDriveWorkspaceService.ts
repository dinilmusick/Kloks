import type { FileInfo } from './types.js';

export const GOOGLE_DRIVE_WORKSPACE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API_URL = 'https://www.googleapis.com/drive/v3';
const GOOGLE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface GoogleDriveWorkspaceTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
}

export interface GoogleDriveWorkspaceOptions {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  tokens?: GoogleDriveWorkspaceTokens;
  rootFolderId?: string;
  fetcher?: typeof fetch;
  persistTokens?: (tokens: GoogleDriveWorkspaceTokens) => Promise<void> | void;
}

export interface GoogleDriveWorkspaceFolder {
  id: string;
  name: string;
  mimeType: string;
  parentIds: string[];
  modifiedAt: number;
}

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
};

function encodeBytes(parts: Array<string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const buffers = parts.map((part) => typeof part === 'string' ? encoder.encode(part) : part);
  const output = new Uint8Array(buffers.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of buffers) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

function quoteDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function parseJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

/**
 * Fetch-native Google Drive implementation for Worker/edge runtimes.
 *
 * This class deliberately uses only the Web Fetch, URL, TextEncoder and
 * Uint8Array APIs. It does not import googleapis, Node streams or filesystem
 * modules, so it can be bundled into Cloudflare Workers and serverless APIs.
 * OAuth credentials are supplied and persisted only by server-side callers.
 */
export class GoogleDriveWorkspaceService {
  private readonly options: GoogleDriveWorkspaceOptions;
  private readonly fetcher: typeof fetch;
  private tokens: GoogleDriveWorkspaceTokens;
  private refreshPromise?: Promise<GoogleDriveWorkspaceTokens>;

  constructor(options: GoogleDriveWorkspaceOptions) {
    if (!options.clientId?.trim()) throw new Error('Google Drive OAuth client ID is required.');
    if (!options.redirectUri?.trim()) throw new Error('Google Drive OAuth redirect URI is required.');
    this.options = options;
    this.fetcher = options.fetcher || fetch;
    this.tokens = { ...(options.tokens || { accessToken: '' }) };
  }

  static createAuthorizationUrl(
    options: Pick<GoogleDriveWorkspaceOptions, 'clientId' | 'redirectUri'>,
    state: string,
    scopes: string[] = [GOOGLE_DRIVE_WORKSPACE_SCOPE],
  ): string {
    if (!options.clientId?.trim() || !options.redirectUri?.trim()) {
      throw new Error('Google Drive OAuth client ID and redirect URI are required.');
    }
    if (!state?.trim()) throw new Error('A non-empty Google Drive OAuth state is required.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('redirect_uri', options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  }

  static async exchangeAuthorizationCode(
    options: Pick<GoogleDriveWorkspaceOptions, 'clientId' | 'clientSecret' | 'redirectUri' | 'fetcher'>,
    code: string,
    existingRefreshToken?: string,
    codeVerifier?: string,
  ): Promise<GoogleDriveWorkspaceTokens> {
    if (!code?.trim()) throw new Error('Google Drive authorization code is required.');
    return GoogleDriveWorkspaceService.requestTokens(
      options.fetcher || fetch,
      {
        client_id: options.clientId,
        client_secret: options.clientSecret || '',
        redirect_uri: options.redirectUri,
        grant_type: 'authorization_code',
        code,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      },
      existingRefreshToken,
    );
  }

  private static async requestTokens(
    fetcher: typeof fetch,
    fields: Record<string, string>,
    existingRefreshToken?: string,
  ): Promise<GoogleDriveWorkspaceTokens> {
    const response = await fetcher(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      cache: 'no-store',
    });
    const data = await parseJson(response);
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
      const reason = typeof data.error === 'string' ? data.error : 'token_exchange_failed';
      throw new Error(`Google Drive OAuth token request failed (${reason}).`);
    }
    return {
      accessToken: data.access_token,
      ...(data.refresh_token || existingRefreshToken
        ? { refreshToken: data.refresh_token || existingRefreshToken }
        : {}),
      ...(Number.isFinite(Number(data.expires_in))
        ? { expiresAt: Date.now() + Number(data.expires_in) * 1000 }
        : {}),
      ...(typeof data.token_type === 'string' ? { tokenType: data.token_type } : {}),
    };
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    const expiresSoon = Boolean(this.tokens.expiresAt && this.tokens.expiresAt <= Date.now() + 60_000);
    if (!forceRefresh && this.tokens.accessToken && !expiresSoon) return this.tokens.accessToken;
    if (!this.tokens.refreshToken || !this.options.clientSecret) {
      throw new Error('Google Drive credentials are missing or expired. Reconnect the Google account.');
    }
    if (!this.refreshPromise) {
      this.refreshPromise = GoogleDriveWorkspaceService.requestTokens(
        this.fetcher,
        {
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          refresh_token: this.tokens.refreshToken,
          grant_type: 'refresh_token',
        },
        this.tokens.refreshToken,
      ).then(async (tokens) => {
        this.tokens = tokens;
        await this.options.persistTokens?.(tokens);
        return tokens;
      }).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    const refreshed = await this.refreshPromise;
    return refreshed.accessToken;
  }

  private async api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(
      path.startsWith('https://') ? path : `${GOOGLE_API_URL}/${path.replace(/^\/+/, '')}`,
      {
        ...init,
        headers: {
          ...(init.headers || {}),
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      },
    );
    if (response.status === 401 && retry && this.tokens.refreshToken) {
      await this.getAccessToken(true);
      return this.api(path, init, false);
    }
    if (!response.ok) {
      const data = await parseJson(response);
      const message = typeof data.error?.message === 'string'
        ? data.error.message
        : `Google Drive request failed with HTTP ${response.status}.`;
      throw new Error(message);
    }
    return response;
  }

  private async listFiles(parentId: string, query = 'trashed = false'): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const url = new URL(`${GOOGLE_API_URL}/files`);
      url.searchParams.set('q', `'${quoteDriveQuery(parentId)}' in parents and ${query}`);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)');
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await parseJson(await this.api(url.toString()));
      if (Array.isArray(data.files)) files.push(...data.files);
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    } while (pageToken);
    return files;
  }

  private async findChild(parentId: string, name: string): Promise<DriveFile | undefined> {
    const matches = await this.listFiles(
      parentId,
      `name = '${quoteDriveQuery(name)}' and trashed = false`,
    );
    return matches.find((item) => Boolean(item.id));
  }

  private async resolveParent(relativePath: string, create = false): Promise<string> {
    let parent = this.options.rootFolderId || 'root';
    for (const segment of relativePath.replace(/\\/g, '/').split('/').filter(Boolean)) {
      let child = await this.findChild(parent, segment);
      if (!child && create) {
        const data = await parseJson(await this.api('files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: segment,
            mimeType: FOLDER_MIME_TYPE,
            parents: [parent],
          }),
        }));
        child = data;
      }
      if (!child?.id || child.mimeType !== FOLDER_MIME_TYPE) {
        throw new Error(`Google Drive folder not found: ${segment}`);
      }
      parent = child.id;
    }
    return parent;
  }

  private splitPath(value: string): { parent: string; name: string } {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const index = normalized.lastIndexOf('/');
    return index < 0
      ? { parent: '', name: normalized }
      : { parent: normalized.slice(0, index), name: normalized.slice(index + 1) };
  }

  async getAccountIdentity(): Promise<{ accountId: string; email?: string }> {
    const url = new URL(`${GOOGLE_API_URL}/about`);
    url.searchParams.set('fields', 'user(permissionId,emailAddress)');
    const data = await parseJson(await this.api(url.toString()));
    const accountId = data.user?.permissionId || data.user?.emailAddress;
    if (typeof accountId !== 'string' || !accountId) {
      throw new Error('Google Drive did not return a stable account identity.');
    }
    return {
      accountId,
      ...(typeof data.user?.emailAddress === 'string' ? { email: data.user.emailAddress } : {}),
    };
  }

  async listFolders(parentFolderId = this.options.rootFolderId || 'root'): Promise<GoogleDriveWorkspaceFolder[]> {
    const files = await this.listFiles(
      parentFolderId,
      `mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
    );
    return files.flatMap((file) => file.id && file.name ? [{
      id: file.id,
      name: file.name,
      mimeType: FOLDER_MIME_TYPE,
      parentIds: file.parents || [],
      modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
    }] : []);
  }

  async resolveFolder(folderId: string): Promise<GoogleDriveWorkspaceFolder> {
    if (!folderId?.trim()) throw new Error('A Google Drive folder ID is required.');
    const url = new URL(`${GOOGLE_API_URL}/files/${encodeURIComponent(folderId)}`);
    url.searchParams.set('fields', 'id,name,mimeType,parents,modifiedTime');
    url.searchParams.set('supportsAllDrives', 'true');
    const file = await parseJson(await this.api(url.toString()));
    if (!file.id || !file.name || file.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error('The selected Google Drive item is not a folder.');
    }
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parentIds: file.parents || [],
      modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
    };
  }

  async selectRootFolder(folderId: string): Promise<GoogleDriveWorkspaceFolder> {
    const folder = await this.resolveFolder(folderId);
    this.options.rootFolderId = folder.id;
    return folder;
  }

  async read(path: string): Promise<Uint8Array> {
    const { parent, name } = this.splitPath(path);
    if (!name) throw new Error('A Google Drive file path is required.');
    const parentId = await this.resolveParent(parent);
    const file = await this.findChild(parentId, name);
    if (!file?.id || file.mimeType === FOLDER_MIME_TYPE) throw new Error(`Google Drive file not found: ${path}`);
    const url = new URL(`${GOOGLE_API_URL}/files/${encodeURIComponent(file.id)}`);
    url.searchParams.set('alt', 'media');
    return new Uint8Array(await (await this.api(url.toString())).arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array | string, contentType = 'application/octet-stream'): Promise<void> {
    const { parent, name } = this.splitPath(path);
    if (!name) throw new Error('A Google Drive file name is required.');
    const parentId = await this.resolveParent(parent, true);
    const existing = await this.findChild(parentId, name);
    if (existing?.mimeType === FOLDER_MIME_TYPE) throw new Error(`Google Drive path is a folder: ${path}`);

    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    const boundary = `kloks-drive-${crypto.randomUUID()}`;
    const body = encodeBytes([
      `--${boundary}\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n`,
      JSON.stringify({
        name,
        mimeType: contentType,
        ...(!existing?.id ? { parents: [parentId] } : {}),
      }),
      `\\r\\n--${boundary}\\r\\nContent-Type: ${contentType}\\r\\n\\r\\n`,
      data,
      `\\r\\n--${boundary}--`,
    ]);
    const endpoint = existing?.id
      ? `${GOOGLE_UPLOAD_URL}/files/${encodeURIComponent(existing.id)}?uploadType=multipart&supportsAllDrives=true`
      : `${GOOGLE_UPLOAD_URL}/files?uploadType=multipart&supportsAllDrives=true`;
    await this.api(endpoint, {
      method: existing?.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: body.buffer as ArrayBuffer,
    });
  }

  async delete(path: string): Promise<void> {
    const { parent, name } = this.splitPath(path);
    const parentId = await this.resolveParent(parent);
    const file = await this.findChild(parentId, name);
    if (!file?.id) return;
    await this.api(`files/${encodeURIComponent(file.id)}?supportsAllDrives=true`, { method: 'DELETE' });
  }

  async exists(path: string): Promise<boolean> {
    try { await this.stat(path); return true; }
    catch (error) {
      if (error instanceof Error && /not found|404/i.test(error.message)) return false;
      throw error;
    }
  }

  async list(path = ''): Promise<FileInfo[]> {
    const parentId = await this.resolveParent(path);
    const files = await this.listFiles(parentId);
    return files.flatMap((file) => file.name ? [{
      path: path ? `${path.replace(/\/+$/, '')}/${file.name}` : file.name,
      size: Number(file.size || 0),
      modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
    }] : []);
  }

  async stat(path: string): Promise<FileInfo> {
    const { parent, name } = this.splitPath(path);
    const parentId = await this.resolveParent(parent);
    const file = await this.findChild(parentId, name);
    if (!file?.id) throw new Error(`Google Drive file not found: ${path}`);
    return {
      path,
      size: Number(file.size || 0),
      modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
    };
  }

  async mkdir(path: string): Promise<void> {
    await this.resolveParent(path, true);
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string; details?: Record<string, unknown> }> {
    const started = Date.now();
    try {
      const identity = await this.getAccountIdentity();
      return {
        ok: true,
        latencyMs: Date.now() - started,
        details: { accountId: identity.accountId, email: identity.email, rootFolderId: this.options.rootFolderId || 'root' },
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'Google Drive connection failed.',
      };
    }
  }

  getConnectionMetadata(): Record<string, string> {
    return {
      provider: 'google_drive',
      ...(this.options.rootFolderId ? { googleRootFolderId: this.options.rootFolderId } : {}),
    };
  }
}
