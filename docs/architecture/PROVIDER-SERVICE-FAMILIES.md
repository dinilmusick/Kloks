# Provider service families

Kloks owns the canonical provider registry, API contracts and adapters.
SRKL consumes `listRecognizedAccountServices()` and retains **all** account
credentials, secrets, per-user authorization and workspace ownership.

## Google family (single hierarchy)

```
Google [suite; OAuth account identity]
├── Gemini Developer API [API key; models]
├── Google Drive [OAuth; files and folders]
├── Google Cloud Run [catalog only]
├── Google Cloud Storage [catalog only]
├── Google Cloud Shell [catalog only]
└── Vertex AI [catalog only]
```

A Google account is **not** one universal credential granting all Google APIs.
Each child requires its own OAuth scopes, API key, project context and access
verification. Google AI Studio is an alias for Gemini; it is not a duplicate
credential record. `listProviderServiceTree()`, `listProviderServiceChildren()`
and `getProviderServicePath()` expose the hierarchy to applications.

## Canonical storage service catalogue

| ID | API status | Credential mode | Canonical operations |
| --- | --- | --- | --- |
| `backblaze-b2` | implemented, existing | application key | existing B2 authorize, buckets, files, upload/download |
| `github` | new read-only adapter | scoped token or OAuth | list account repositories, list repository contents |
| `gitlab` | new read-only adapter | scoped token or OAuth | list member projects and repository tree (GitLab.com) |
| `dropbox` | new read-only adapter | OAuth token | list folders and continue cursor |
| `google-drive` | implemented, existing | scoped OAuth | existing GoogleDriveWorkspaceService |
| `google-cloud-storage` | catalog only | scoped Google OAuth | **none**; cannot connect until implemented |

New source entrypoint: `@ultrst-armada/kloks/provider-services`.

The generic API transport uses fixed provider origins, guards against URL
changes, rejects redirects and never places credentials in request URLs.
Only trusted backend integrations can obtain access tokens from SRKL; these
wrappers are not authorization boundaries by themselves. B2 and Drive reuse
existing Kloks implementations, not parallel implementations.

`ready` means a canonical adapter exists and has fixture/contract tests,
**not** live-account verification. A successful integration cannot be claimed
until the corresponding provider is exercised with a real scoped account.

## Adoption and testing gates

- Build and typecheck Kloks; verify public package exports and test catalog tree,
  existing B2/Drive compatibility, API response shapes, auth boundaries and
  provider mismatches.
- Publish a new Kloks version before migrating SRKL's duplicate service templates.
- Keep existing SRKL credentials untouched until a tested migration adopts
  the canonical IDs and schema. Do not flatten Google child services into one
  credential, and do not merge unlike scopes.
- Deploy no changes to DEPM/Frnes routing from this catalogue alone. Storage
  quota reporting is separate, and renewal assumptions must be verified
  for each provider, especially project-level storage credits.
- Support for enterprise/custom GitLab domains requires explicit trusted
  endpoint configuration; never accept arbitrary account-provided origins.
