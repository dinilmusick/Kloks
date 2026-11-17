/**
 * @file b2ExplorerOperations.ts
 * @description Canonical owner-scoped B2 bucket and file Explorer operations.
 * Browser callers only supply opaque connection IDs, not B2 credentials.
 */
import {
  b2DownloadFile, b2UploadFile,
} from './b2DirectCore.js';
import {
  type B2ExplorerInput, type B2ExplorerContext,
  postB2Explorer, resolveB2ExplorerContext, safeB2ExplorerPath,
  selectB2ExplorerBucket,
} from './b2ExplorerContext.js';

type FileVersion = { fileId?: string; fileName?: string; [key: string]: unknown };

function required(value: string | undefined, name: string): string {
  if (!value || !value.trim()) throw new Error(`B2 ${name} is required.`);
  return value.trim();
}
function decodedBytes(value: string | undefined): Uint8Array {
  if (typeof value !== 'string' || !value || value.length > 36_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('B2 base64 content is missing, malformed or too large.');
  }
  const raw = atob(value);
  if (raw.length > 25 * 1024 * 1024) throw new Error('B2 upload exceeds the 25 MiB Explorer limit.');
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Exhaust pagination without falsely reporting partial deletion as success. */
async function listVersions(context: B2ExplorerContext, bucketId: string, prefix: string): Promise<FileVersion[]> {
  const found: FileVersion[] = [];
  let startFileName: string | undefined;
  let startFileId: string | undefined;
  for (let page = 0; page < 100; page++) {
    const data = await postB2Explorer(context.auth, 'b2_list_file_versions', {
      bucketId, prefix, maxFileCount: 1000,
      ...(startFileName ? { startFileName, startFileId } : {}),
    });
    if (!Array.isArray(data.files)) throw new Error('B2 version listing returned invalid data.');
    found.push(...data.files);
    if (!data.nextFileName) return found;
    if (data.nextFileName === startFileName && data.nextFileId === startFileId) {
      throw new Error('B2 version cursor did not advance.');
    }
    startFileName = data.nextFileName;
    startFileId = data.nextFileId;
  }
  throw new Error('B2 version listing exceeded the safe pagination limit.');
}

async function deleteVersions(
  context: B2ExplorerContext, bucketId: string, prefix: string, exactFile?: string, exactId?: string,
) {
  const versions = (await listVersions(context, bucketId, prefix)).filter((f) =>
    typeof f.fileName === 'string'
    && (exactFile ? f.fileName === exactFile : f.fileName.startsWith(prefix))
    && (!exactId || f.fileId === exactId),
  );
  if (exactId && versions.length !== 1) throw new Error('The B2 file version is not present in the selected bucket.');
  let deletedCount = 0;
  for (const file of versions) {
    if (!file.fileId || !file.fileName) throw new Error('B2 version metadata is incomplete; deletion cancelled.');
    await postB2Explorer(context.auth, 'b2_delete_file_version', {
      fileName: file.fileName, fileId: file.fileId,
    });
    deletedCount++;
  }
  return { deletedCount };
}

export async function executeB2Explorer(input: B2ExplorerInput): Promise<unknown> {
  const action = input.action;
  const actions: B2ExplorerInput['action'][] = [
    'listBuckets', 'createBucket', 'deleteBucket', 'listFiles',
    'createFolder', 'uploadFile', 'readFile', 'deleteFile', 'deleteFolder',
  ];
  if (!actions.includes(action)) throw new Error('Unsupported B2 Explorer operation.');
  if (!input.userId || !input.connectionId) throw new Error('Verified owner and connection ID are required.');
  if (['uploadFile', 'readFile', 'deleteFile'].includes(action)) safeB2ExplorerPath(input.fileName);
  if (['createFolder', 'deleteFolder'].includes(action)) safeB2ExplorerPath(input.folderPath);
  const ctx = await resolveB2ExplorerContext(input);
  if (action === 'listBuckets') {
    return ctx.buckets.map(({ bucketId, bucketName, bucketType, bucketInfo, revision }) =>
      ({ bucketId, bucketName, bucketType, bucketInfo, revision }));
  }
  if (action === 'createBucket') {
    const bucketName = required(input.bucketName, 'bucket name');
    if (!/^[A-Za-z0-9-]{6,50}$/.test(bucketName)) throw new Error('B2 bucket name is invalid.');
    // A key restricted to an existing bucket cannot create account-wide buckets.
    if (ctx.auth.allowed?.bucketId || ctx.auth.allowed?.bucketName || ctx.auth.allowed?.buckets?.length) {
      throw new Error('This B2 key is restricted to an existing bucket.');
    }
    return postB2Explorer(ctx.auth, 'b2_create_bucket', {
      accountId: ctx.auth.accountId, bucketName, bucketType: input.bucketType || 'allPrivate',
    });
  }
  const bucket = selectB2ExplorerBucket(ctx, input.bucketId, input.bucketName);
  if (action === 'deleteBucket') {
    await postB2Explorer(ctx.auth, 'b2_delete_bucket', {
      accountId: ctx.auth.accountId, bucketId: bucket.bucketId,
    });
    return { success: true };
  }
  if (action === 'listFiles') {
    const prefix = input.prefix ? safeB2ExplorerPath(input.prefix.replace(/\/$/, '')) : '';
    const files: FileVersion[] = [];
    let startFileName: string | undefined;
    for (let page = 0; page < 100; page++) {
      const data = await postB2Explorer(ctx.auth, 'b2_list_file_names', {
        bucketId: bucket.bucketId, prefix, maxFileCount: 1000,
        ...(startFileName ? { startFileName } : {}),
      });
      if (!Array.isArray(data.files)) throw new Error('B2 file listing returned invalid data.');
      files.push(...data.files);
      if (!data.nextFileName) return { files };
      if (data.nextFileName === startFileName) throw new Error('B2 file cursor did not advance.');
      startFileName = data.nextFileName;
    }
    throw new Error('B2 file listing exceeded the safe pagination limit.');
  }
  if (action === 'createFolder') {
    const fileName = `${safeB2ExplorerPath(input.folderPath)}/.bzEmpty`;
    const file = await b2UploadFile(ctx.keyId, ctx.applicationKey, bucket.bucketName, fileName, new Uint8Array(0));
    return { file, folderPath: input.folderPath };
  }
  if (action === 'uploadFile') {
    const fileName = safeB2ExplorerPath(input.fileName);
    return b2UploadFile(ctx.keyId, ctx.applicationKey, bucket.bucketName, fileName, decodedBytes(input.fileBase64), input.contentType || 'b2/x-auto');
  }
  if (action === 'readFile') {
    return b2DownloadFile(ctx.keyId, ctx.applicationKey, bucket.bucketName, safeB2ExplorerPath(input.fileName));
  }
  if (action === 'deleteFile') {
    const fileName = safeB2ExplorerPath(input.fileName);
    return deleteVersions(ctx, bucket.bucketId, fileName, fileName, input.fileId);
  }
  if (action === 'deleteFolder') {
    const prefix = safeB2ExplorerPath(input.folderPath) + '/';
    return deleteVersions(ctx, bucket.bucketId, prefix);
  }
  throw new Error('Unsupported B2 Explorer operation.');
}
