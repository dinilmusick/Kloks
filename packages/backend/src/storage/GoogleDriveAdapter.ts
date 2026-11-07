import { google } from '@dinilmusick/gutts/storage';
import { Readable } from 'node:stream';
import { BaseStorageAdapter } from './BaseStorageAdapter.js';
import { FileInfo, StorageConfig, ConnectionTestResult } from './types.js';

type DriveFile = any;

export class GoogleDriveAdapter extends BaseStorageAdapter {
  private client?: any;
  private auth?: any;

  private getAuth(): any {
    if (this.auth) return this.auth;

    const client = new google.auth.OAuth2(
      this.config.googleClientId,
      undefined,
      this.config.googleRedirectUri,
    );

    const accessToken = this.config.googleAccessToken;
    const refreshToken = this.config.googleRefreshToken;
    const expiresAt = Number(this.config.googleAccessTokenExpiresAt || 0);

    if (accessToken) {
      client.setCredentials({
        access_token: accessToken,
        ...(expiresAt ? { expiry_date: expiresAt } : {}),
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
      });
    } else if (refreshToken) {
      client.setCredentials({ refresh_token: refreshToken });
    } else {
      throw new Error('Google Drive OAuth credentials are incomplete.');
    }

    this.auth = client;
    return client;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    const auth = this.getAuth();
    const token = await auth.getAccessToken();
    if (!token.token) throw new Error('Google Drive authorization returned no access token.');

    this.config.googleAccessToken = token.token;
    if (auth.credentials.expiry_date) {
      this.config.googleAccessTokenExpiresAt = auth.credentials.expiry_date;
    }

    this.client = google.drive({ version: 'v3', auth });
    return this.client!;
  }

  private async findChild(parentId: string, name: string): Promise<DriveFile | null> {
    const drive = await this.getClient();
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const response = await drive.files.list({
      q: `'${parentId}' in parents and name = '${escapedName}' and trashed = false`,
      fields: 'files(id,name,size,modifiedTime,mimeType)',
      pageSize: 10,
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
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parent],
          },
          fields: 'id,name,mimeType',
        });
        child = response.data;
      }

      if (!child?.id) {
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

  async read(pathStr: string): Promise<Uint8Array> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file?.id) throw new Error(`Google Drive file not found: ${pathStr}`);

    const drive = await this.getClient();
    const response = await drive.files.get(
      { fileId: file.id, alt: 'media' },
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
    const parent = await this.resolveParent(dir, true);
    const existing = await this.findChild(parent, name);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const drive = await this.getClient();

    if (existing?.id) {
      await drive.files.update({
        fileId: existing.id,
        requestBody: { name, mimeType: contentType },
        media: { mimeType: contentType, body: Readable.from(bytes) },
        fields: 'id',
      });
      return;
    }

    await drive.files.create({
      requestBody: { name, mimeType: contentType, parents: [parent] },
      media: { mimeType: contentType, body: Readable.from(bytes) },
      fields: 'id',
    });
  }

  async delete(pathStr: string): Promise<void> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file?.id) return;

    const drive = await this.getClient();
    try {
      await drive.files.delete({ fileId: file.id });
    } catch (error: any) {
      if (error?.response?.status !== 404) throw error;
    }
  }

  async exists(pathStr: string): Promise<boolean> {
    try {
      await this.stat(pathStr);
      return true;
    } catch (error: any) {
      if (error?.response?.status === 404) return false;
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
        ...(pageToken ? { pageToken } : {}),
      });

      for (const file of response.data.files || []) {
        if (!file.name) continue;
        results.push({
          path: this.normalizePath(pathStr ? `${pathStr}/${file.name}` : file.name),
          size: Number(file.size || 0),
          modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
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
    };
  }

  async mkdir(pathStr: string): Promise<void> {
    await this.resolveParent(pathStr, true);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = performance.now();

    try {
      const drive = await this.getClient();
      const response = await drive.about.get({ fields: 'user(emailAddress)' });
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        details: { email: response.data.user?.emailAddress },
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
