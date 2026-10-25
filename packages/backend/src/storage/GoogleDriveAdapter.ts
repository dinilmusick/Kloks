import { BaseStorageAdapter } from './BaseStorageAdapter.js';
import { FileInfo, StorageConfig, ConnectionTestResult } from './types.js';
import { refreshGoogleDriveAccessToken } from './GoogleDriveOAuth.js';

type DriveFile = { id: string; name: string; size?: string; modifiedTime?: string; mimeType: string };

export class GoogleDriveAdapter extends BaseStorageAdapter {
  private async token(): Promise<string> {
    const accessToken = (this.config as any).googleAccessToken || this.config.accessKey;
    const expiresAt = Number((this.config as any).googleAccessTokenExpiresAt || 0);
    if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) return accessToken;
    const refreshToken = (this.config as any).googleRefreshToken;
    const clientId = (this.config as any).googleClientId;
    if (!refreshToken || !clientId) throw new Error('Google Drive OAuth credentials are incomplete.');
    const refreshed = await refreshGoogleDriveAccessToken(clientId, refreshToken);
    (this.config as any).googleAccessToken = refreshed.accessToken;
    (this.config as any).googleAccessTokenExpiresAt = refreshed.expiresAt;
    return refreshed.accessToken;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.token()}`);
    return fetch(url, { ...init, headers });
  }

  private async findChild(parentId: string, name: string): Promise<DriveFile | null> {
    const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const res = await this.request(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime,mimeType)&pageSize=10`);
    if (!res.ok) throw new Error(`Google Drive lookup failed: ${res.status}`);
    const data = await res.json() as { files?: DriveFile[] };
    return data.files?.[0] || null;
  }

  private async resolveParent(relativeDir: string, create = false): Promise<string> {
    let parent = (this.config as any).googleRootFolderId || (this.config as any).rootFolderId || 'root';
    for (const part of this.normalizePath(relativeDir).split('/').filter(Boolean)) {
      let child = await this.findChild(parent, part);
      if (!child && create) {
        const res = await this.request('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: part, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
        });
        if (!res.ok) throw new Error(`Google Drive folder creation failed: ${res.status}`);
        child = await res.json() as DriveFile;
      }
      if (!child) throw new Error(`Google Drive directory not found: ${part}`);
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
    if (!file) throw new Error(`Google Drive file not found: ${pathStr}`);
    const res = await this.request(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    if (!res.ok) throw new Error(`Google Drive download failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(pathStr: string, data: Uint8Array | string, contentType = 'application/octet-stream'): Promise<void> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir, true);
    const existing = await this.findChild(parent, name);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, mimeType: contentType, ...(existing ? {} : { parents: [parent] }) })], { type: 'application/json' }));
    form.append('file', new Blob([bytes as BlobPart], { type: contentType }));
    const url = existing ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await this.request(url, { method: existing ? 'PATCH' : 'POST', body: form });
    if (!res.ok) throw new Error(`Google Drive upload failed: ${res.status}`);
  }

  async delete(pathStr: string): Promise<void> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file) return;
    const res = await this.request(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Google Drive delete failed: ${res.status}`);
  }

  async exists(pathStr: string): Promise<boolean> { try { await this.stat(pathStr); return true; } catch { return false; } }

  async list(pathStr = ''): Promise<FileInfo[]> {
    const parent = await this.resolveParent(pathStr);
    const q = `'${parent}' in parents and trashed = false`;
    const res = await this.request(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime,mimeType)&pageSize=1000`);
    if (!res.ok) throw new Error(`Google Drive list failed: ${res.status}`);
    const data = await res.json() as { files?: DriveFile[] };
    return (data.files || []).map(f => ({ path: this.normalizePath(pathStr ? `${pathStr}/${f.name}` : f.name), size: Number(f.size || 0), modifiedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : 0 }));
  }

  async stat(pathStr: string): Promise<FileInfo> {
    const { dir, name } = this.split(pathStr);
    const parent = await this.resolveParent(dir);
    const file = await this.findChild(parent, name);
    if (!file) throw new Error(`Google Drive file not found: ${pathStr}`);
    return { path: pathStr, size: Number(file.size || 0), modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0 };
  }

  async mkdir(pathStr: string): Promise<void> { await this.resolveParent(pathStr, true); }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = performance.now();
    try {
      const res = await this.request('https://www.googleapis.com/drive/v3/about?fields=user');
      if (!res.ok) throw new Error(`Google Drive authorization failed: ${res.status}`);
      const data = await res.json();
      return { ok: true, latencyMs: Math.round(performance.now() - start), details: { email: data.user?.emailAddress } };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - start), error: e.message };
    }
  }
}