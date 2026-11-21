# Frnes saved cloud-provider accounts — canonical Kloks backend

## Architecture

Verified Luth owner → Frnes trusted backend → Kloks saved-account API →
canonical fixed-origin Kloks provider adapter → encrypted Neon record.

The new APIs are exported ONLY by the Node/server entrypoint
@ultrst-armada/kloks/provider-services/node. No browser-safe or isomorphic
provider registry exports the credential resolver, key or ciphertext.

- saveVerifiedProviderAccount(ownerUserId, input, options?)
- listSavedProviderAccounts(ownerUserId, query?)
- readSavedProviderAccount(ownerUserId, accountId, options?)
- revokeSavedProviderAccount(ownerUserId, accountId, query?)

The trusted Frnes API must derive ownerUserId exclusively from an independently
verified Luth session, check mutation origin, and check the selected workspace
before inviting any cross-application request. No body-supplied owner or
consumer claim is accepted as authority.

## Provider operations (read-only in this phase)

| Provider | Scoped read | Required scope |
| --- | --- | --- |
| Cloudflare | Workers or Pages | 32-character account tag |
| Vercel | Projects or deployments | Optional team ID |
| Fly.io | Apps | Bearer token |
| Render | Services | Bearer API key |
| Railway | Account identity | Account bearer token |
| Google Cloud Run | Services | Project ID and region |

Each new connection requires an independently verified Luth owner and owned
workspace from the calling service, plus a successful provider-backed API read BEFORE
persistence. The authorization proves only access to that service page at
that moment. It does not prove paid lifecycle privileges, billing coverage,
renewable free capacity, future token validity, or ownership of unrelated
resources. Resource listings contain at most 50 redacted entries from the
first API page and always return complete:false.

## Persistence and security

Frnes schema: db/004_frnes_provider_accounts.sql in dinilmusick/Frnes.

The table enables row-level security, publishes no table policy, and revokes
PUBLIC privileges. All SQL uses parameter bindings and an exact owner filter.
Every server API must additionally verify the exact workspace before calling Kloks.
The store filters by BOTH owner ID and workspace ID; a saved account in one
workspace is never automatically available from another. It must not use a
user-side
direct SQL/Data API connection.

A canonical system-owned Kloks storageConnections encryption key is reused.
AES-256-GCM uses a unique 96-bit IV and immutable additional authenticated
data comprising owner ID, workspace ID, account UUID, provider, resource kind, account scope,
project and region. Switching any field invalidates decryption. Initializing
a key is permitted only for encryption; decryption requires the existing
canonical key and cannot silently mint a new one.

No bearer token is returned to Frnes clients, logged, or persisted in plaintext.
Revocation atomically marks an account unusable. Read always selects a single,
exact, enabled account for a single owner; no hidden fallback, provider
substitution, multiple-account quota rotation or workload execution exists.

The wrapper does NOT offer automatic Google OAuth refresh or arbitrary
provider deployment control. Short-lived Cloud Run access tokens will expire
and require renewed authorized credential onboarding until a canonical
provider-specific refresh flow is added. Do not label this end-to-end OAuth.

## Release / acceptance gate

1. Apply the schema through the approved Frnes migration runner with explicit
   owner authorization; the Frnes migration script is separate from the
   concurrently claimed Skipo conformance fix.
2. Run actual Kloks frozen install, Vitest and TypeScript build/architecture
   verification at the exact PR commit in an approved disposable FMRL runner.
3. Release a new immutable Kloks 3.0.1 package with this server-only export.
4. Pin that package in Frnes with a regenerated frozen lockfile. Frnes API/UI
   integration may not assert availability until its exact published package
   contains all new exports.
5. Independently verify live Luth sessions, intended provider permissions,
   database encryption/revocation, two-user denials and consumer consent. Do
   not merge provider access as production-ready from mock-provider tests.

Historical Kloks PR #101 already implements owner-bound GitHub and Dropbox
storage connection work but is closed and UNMERGED. That implementation must
be separately reconciled; it was not duplicated or silently represented as
part of this new compute-provider integration.
