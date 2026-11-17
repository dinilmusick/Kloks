import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveConnection, authorize, listBuckets, upload, download } = vi.hoisted(() => ({
  resolveConnection: vi.fn(),
  authorize: vi.fn(),
  listBuckets: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));

vi.mock('./storageConnectionCore.js', () => ({
  resolveUserStorageConnectionSecret: resolveConnection,
}));
vi.mock('./unifiedDb.js', () => ({
  queryUnifiedDb: vi.fn(),
}));
vi.mock('./b2DirectCore.js', () => ({
  authorizeB2: authorize,
  b2ListBuckets: listBuckets,
  b2UploadFile: upload,
  b2DownloadFile: download,
}));

import { executeB2Explorer } from './b2ExplorerOperations.js';
import { safeB2ExplorerPath } from './b2ExplorerContext.js';

const owner = { action: 'listBuckets' as const, userId: 'alice', connectionId: 'alice-b2' };
const auth = {
  accountId: 'account-a',
  authorizationToken: 'server-private-b2-token',
  apiUrl: 'https://b2-api.example.test',
  downloadUrl: 'https://b2-download.example.test',
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveConnection.mockImplementation(async (userId: string, connectionId: string) =>
    userId === 'alice' && connectionId === 'alice-b2'
      ? { id: connectionId, provider: 'backblaze_b2', b2KeyId: 'private-key-id', b2ApplicationKey: 'private-app-key', enabled: true }
      : null,
  );
  authorize.mockResolvedValue(auth);
  listBuckets.mockResolvedValue([{ bucketId: 'bucket-a', bucketName: 'alice-archive', bucketType: 'allPrivate' }]);
  upload.mockResolvedValue({ fileId: 'file-new', fileName: 'docs/example.txt' });
  download.mockResolvedValue(new Uint8Array([11, 12]));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('owner-scoped canonical B2 Explorer', () => {
  it('fails closed on missing owner, foreign connection, and disabled connection', async () => {
    await expect(executeB2Explorer({ ...owner, userId: '' })).rejects.toThrow(/owner/);
    await expect(executeB2Explorer({ ...owner, userId: 'bob' })).rejects.toThrow(/unavailable/);
    expect(authorize).not.toHaveBeenCalled();
    expect(resolveConnection).toHaveBeenCalledWith('bob', 'alice-b2', expect.any(Function), 'backblaze_b2');
    resolveConnection.mockResolvedValue({ provider: 'backblaze_b2', enabled: false });
    await expect(executeB2Explorer(owner)).rejects.toThrow(/unavailable/);
  });

  it('returns only public bucket metadata, never B2 secrets', async () => {
    const buckets = await executeB2Explorer(owner);
    expect(buckets).toEqual([{ bucketId: 'bucket-a', bucketName: 'alice-archive', bucketType: 'allPrivate', bucketInfo: undefined, revision: undefined }]);
    expect(JSON.stringify(buckets)).not.toMatch(/server-private-b2-token|private-key-id|private-app-key/);
  });

  it('cannot act on buckets outside the owner connection', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(executeB2Explorer({ ...owner, action: 'deleteBucket', bucketId: 'another-bucket' })).rejects.toThrow(/not available/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects path traversal, backslashes, and empty components before credential access', async () => {
    for (const path of ['../secret', 'alpha/../secret', '/root/file', 'alpha//b', 'alpha\\secret', 'alpha/./secret', '']) {
      expect(() => safeB2ExplorerPath(path)).toThrow(/path/);
      await expect(executeB2Explorer({ ...owner, action: 'uploadFile', bucketId: 'bucket-a', fileName: path, fileBase64: 'YQ==' })).rejects.toThrow(/path/);
    }
    expect(resolveConnection).not.toHaveBeenCalled();
  });

  it('uploads and reads through credentials resolved only server-side', async () => {
    await executeB2Explorer({ ...owner, action: 'uploadFile', bucketId: 'bucket-a', fileName: 'docs/example.txt', fileBase64: 'YQ==' });
    expect(upload).toHaveBeenCalledWith('private-key-id', 'private-app-key', 'alice-archive', 'docs/example.txt', new Uint8Array([97]), 'b2/x-auto');
    const result = await executeB2Explorer({ ...owner, action: 'readFile', bucketId: 'bucket-a', fileName: 'docs/example.txt' });
    expect(result).toEqual(new Uint8Array([11, 12]));
    expect(download).toHaveBeenCalledWith('private-key-id', 'private-app-key', 'alice-archive', 'docs/example.txt');
  });

  it('will not delete an unknown version and deletes exact versions only', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [{ fileName: 'docs/example.txt', fileId: 'correct' }], nextFileName: null }),
    });
    vi.stubGlobal('fetch', transport);
    await expect(executeB2Explorer({ ...owner, action: 'deleteFile', bucketId: 'bucket-a', fileName: 'docs/example.txt', fileId: 'wrong' }))
      .rejects.toThrow(/not present/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({ bucketId: 'bucket-a', prefix: 'docs/example.txt' });
    const result = await executeB2Explorer({ ...owner, action: 'deleteFile', bucketId: 'bucket-a', fileName: 'docs/example.txt', fileId: 'correct' });
    expect(result).toEqual({ deletedCount: 1 });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls[2][0]).toContain('b2_delete_file_version');
  });

  it('fails when provider versions cannot be listed; never silently reports success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(executeB2Explorer({ ...owner, action: 'deleteFolder', bucketId: 'bucket-a', folderPath: 'docs' }))
      .rejects.toThrow(/503/);
  });
});
