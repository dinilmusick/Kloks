# Provider Services Contract v1 — Kloks

## Purpose

Kloks is the single canonical provider API layer. SRKL owns the credential vault
and the allowed account-connection UI. FRNES/DEPM own policy and allocation.
Any consuming app must import provider definitions and API operations from Kloks
instead of recreating provider lists, writing provider-specific REST calls or
storing direct API credentials in application environment variables.

## Google as an importable suite

```text
@ultrst-armada/kloks/provider-services/google
├── /drive          [implemented existing GoogleDriveWorkspaceService]
├── /gemini         [implemented models API, usage data unknown]
├── /cloud-run      [catalogue only]
├── /cloud-storage  [catalogue only]
├── /cloud-shell    [catalogue only]
└── /vertex-ai      [catalogue only]
```

The group entrypoint exposes `getGoogleSuite()` and `listGoogleServices()`,
and the canonical registry retains the existing stable IDs
`google-drive`, `google-gemini`, `google-cloud-run`, etc.
Consumers import individual subpaths without loading the full suite.

**An OAuth Google identity does not implicitly grant Drive, Cloud Run, Cloud
Storage, or Vertex AI permissions**. Gemini API keys cannot be reused as Drive
tokens. Parent grouping is an organizational feature, not credential sharing.

## Canonical storage interface

```ts
import {
  createCanonicalStorageService,
  getCanonicalStorageCapabilities,
} from '@ultrst-armada/kloks/provider-services/storage';
import { listGoogleServices } from '@ultrst-armada/kloks/provider-services/google';
import { createGoogleDriveStorageService } from '@ultrst-armada/kloks/provider-services/google/drive';

const capabilities = getCanonicalStorageCapabilities('github');
// { list: true, read: true, write: false, delete: false }
// An authenticated server first resolves a workspace-authorized vault connection:
const storage = createCanonicalStorageService({ providerId: 'github', connection });
const page = await storage.list('/owner/repository/path');
const bytes = await storage.read('/owner/repository/file.txt');
```

All storage adapters expose `list(path?, cursor?)`, `read(path)`,
`write(path, bytes, contentType?)`, and `delete(path)` and a typed,
readonly `capabilities` object. Unsupported operations throw
`UnsupportedStorageOperation` with stable code `STORAGE_OPERATION_UNSUPPORTED`;
they never silently mock success. A normalized `StoragePage` includes
`entries`, `nextCursor`, and `complete` so providers do not falsely
claim that truncated results are exhaustive.

| Provider | list | read | write | delete | Semantics |
|---|---|---|---|---|---|
| GitHub | ✓ | ✓ | — | — | /owner/repo/path; contents API supports small files, explicit repository revisions needed for writes |
| Backblaze B2 | ✓ | ✓ | ✓ | — | /bucket/object; delete requires file-version semantics |
| Google Drive | ✓ | ✓ | ✓ | ✓ | OAuth scopes and canonical workspace-root confinement |
| Dropbox | ✓ | ✓ | ✓ | ✓ | OAuth folder pagination, binary downloads, add-only upload (never silently overwrite), explicit deletion |

`/provider-services/storage/node` exposes the Node-only KrnlTS
`CanonicalStorageProviderService` facade with the same operations.

Existing full native B2 and Drive interfaces remain available; these
normalized operations are adapters to the existing functionality, not
parallel implementations of the provider SDKs.

## Security and evidence requirements

- Resolve credentials on a trusted backend through an authorized Luth/SRKL
  context. A token is scoped to one provider/account, not a transferable
  universal credential. Never send raw credentials to browser widgets.
- Fixed API origins only (including Dropbox content domain), redirects rejected,
  request deadlines enforced. Do not echo tokens to logs or errors.
- Validate paths, report pagination boundaries, and prevent silent provider
  capability substitution.
- Catalogued Google services remain *unimplemented* even though importable
  metadata is available. Provider quota/safety gates and live OAuth/credential
  tests remain separate acceptance requirements.
- Publish and independently verify the new npm tarball before any SRKL, DEPM,
  FRNES or other downstream migration. End-to-end provider calls with user
  accounts are **not certified** by fixture-based CI.
