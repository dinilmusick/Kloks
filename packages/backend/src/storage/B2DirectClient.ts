/**
 * Backward-compatible storage-layer entrypoint for the canonical B2 client.
 * All provider behavior lives in core/b2DirectCore so connection discovery
 * and workspace file operations share the same authorization and error rules.
 */
export {
  authorizeB2,
  b2ListBuckets,
  b2ListFileNames,
  b2UploadFile,
  b2DownloadFile,
} from '../core/b2DirectCore.js';

export type { B2AuthData as B2AuthToken } from '../core/b2DirectCore.js';
