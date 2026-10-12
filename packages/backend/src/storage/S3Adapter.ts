import { BaseStorageAdapter } from './BaseStorageAdapter.js';
import {
  FileInfo,
  StorageConfig,
  DeleteFolderResult,
  RenameFolderResult,
  ConnectionTestResult,
} from './types.js';
import {
  permanentDeleteS3Object,
  permanentDeleteS3Folder,
  ensureS3DirectoryMarker,
  renameS3Folder,
} from './s3Purge.js';

let S3Client: any;
let PutObjectCommand: any;
let GetObjectCommand: any;
let ListObjectsV2Command: any;
let HeadObjectCommand: any;

export class S3Adapter extends BaseStorageAdapter {
  private client: any;
  private bucket: string;

  constructor(config: StorageConfig) {
    super(config);
    this.bucket = config.bucket || '';
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return;
    try {
      const aws = await import('@aws-sdk/client-s3');
      S3Client = aws.S3Client;
      PutObjectCommand = aws.PutObjectCommand;
      GetObjectCommand = aws.GetObjectCommand;
      ListObjectsV2Command = aws.ListObjectsV2Command;
      HeadObjectCommand = aws.HeadObjectCommand;

      this.client = new S3Client({
        region: this.config.region || 'us-east-1',
        endpoint: this.config.endpoint,
        credentials: {
          accessKeyId: this.config.accessKey!,
          secretAccessKey: this.config.secretKey!,
        },
        forcePathStyle: Boolean(this.config.endpoint),
      });
    } catch (e: any) {
      throw new Error(`@aws-sdk/client-s3 failed to initialize: ${e.message}`);
    }
  }

  async read(pathStr: string): Promise<Uint8Array> {
    await this.ensureClient();
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: this.normalizePath(pathStr) });
    const response = await this.client.send(command);
    return response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
  }

  async write(pathStr: string, data: Uint8Array | string, contentType = 'application/octet-stream'): Promise<void> {
    await this.ensureClient();
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.normalizePath(pathStr),
      Body: body,
      ContentType: contentType,
    });
    await this.client.send(command);
  }

  async delete(pathStr: string): Promise<void> {
    await this.ensureClient();
    await permanentDeleteS3Object(this.client, this.bucket, this.normalizePath(pathStr));
  }

  async deleteFolder(pathStr: string): Promise<DeleteFolderResult> {
    await this.ensureClient();
    return await permanentDeleteS3Folder(this.client, this.bucket, this.normalizePath(pathStr));
  }

  async renameFolder(oldPath: string, newPath: string): Promise<RenameFolderResult> {
    await this.ensureClient();
    return await renameS3Folder(this.client, this.bucket, this.normalizePath(oldPath), this.normalizePath(newPath));
  }

  async ensureDirectory(pathStr: string): Promise<void> {
    await this.ensureClient();
    await ensureS3DirectoryMarker(this.client, this.bucket, this.normalizePath(pathStr));
  }

  async exists(pathStr: string): Promise<boolean> {
    await this.ensureClient();
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: this.normalizePath(pathStr) });
      await this.client.send(command);
      return true;
    } catch (e: any) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }

  async list(pathStr = ''): Promise<FileInfo[]> {
    await this.ensureClient();
    const prefix = pathStr ? this.normalizePath(pathStr).replace(/\/+$/, '') + '/' : '';
    const command = new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix });
    const response = await this.client.send(command);

    return (response.Contents || []).map((item: any) => ({
      path: item.Key!,
      size: item.Size || 0,
      modifiedAt: item.LastModified ? item.LastModified.getTime() : 0,
    }));
  }

  async stat(pathStr: string): Promise<FileInfo> {
    await this.ensureClient();
    const command = new HeadObjectCommand({ Bucket: this.bucket, Key: this.normalizePath(pathStr) });
    const response = await this.client.send(command);
    return {
      path: pathStr,
      size: response.ContentLength || 0,
      modifiedAt: response.LastModified ? response.LastModified.getTime() : 0,
    };
  }

  async mkdir(pathStr: string): Promise<void> {
    await this.ensureDirectory(pathStr);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = performance.now();
    try {
      await this.ensureClient();
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        details: { bucket: this.bucket, keyCount: res.KeyCount ?? 0 },
      };
    } catch (e: any) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        error: e.message,
      };
    }
  }
}
