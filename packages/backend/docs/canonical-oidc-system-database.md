# Canonical application OAuth 2.1 configuration

**System database is the source of truth.** All applications, regardless of
local, Cloudflare, Vercel, or server process runtime, accept only these runtime
configuration entries:

- `APP_URL` — exact origin of this deployed application.
- `SYSTEM_DATABASE_URL` — canonical system database.
- `SYSTEM_DATABASE_URL_2`, `SYSTEM_DATABASE_URL_3` — optional system
  database failovers.

Luth remains the only Better Auth OAuth issuer. The application ID is an
immutable argument embedded in the consumer code, not a request field or an
environment variable.

## Enrollment authority and storage

Only an authenticated *active Luth administrator* can create an OAuth client.
The operator chooses an HTTPS origin already enabled in the canonical
`ultrst-apps` + `luth_auth_origins` registry. Luth calls the official
Better Auth `adminCreateOAuthClient` API, then stores the returned
confidential secret and a cryptographically random, stable encryption key in:

`public."ultrst-credentials".credentials.applicationOAuth["<appId>|<origin>"]`

The object contains `clientId`, `clientSecret`, and `bffSecret`. Neither
client secret nor BFF key is exposed in the administrator's browser. The
system credentials table **must** be readable only by the trusted backend
database role; no browser API/public role grants are permitted.

On every request Kloks resolves this record through the canonical system
database, verifies active app, ecosystem, registered origin, and official
non-disabled OAuth client bound to that same origin, then calls its existing
OAuth BFF with the verified credentials. The BFF maintains PKCE, one-use
login state, encrypted server-side tokens, first-party HttpOnly cookies,
refresh and logout. Credentials are not cached across requests so a disabled
client or origin immediately fails closed.

A database outage may use the optional configured failover URL, but a
successful query reporting disabled/missing or mismatched credentials does
**not** fall through to another database: explicit revocation is authoritative.

**Do not introduce** `LUTH_OAUTH_CLIENT_ID`,
`LUTH_OAUTH_CLIENT_SECRET`, `LUTH_OAUTH_BFF_SECRET`,
`BETTER_AUTH_SECRET`, Google keys, or any other application secrets as
environment bindings or browser state.

## Release and verification

1. Verify this implementation and its packaged exports in Kloks exact-head CI.
2. Publish the immutable `@ultrst-armada/kloks@2.2.8` from the verified
   `main` release workflow using explicit operator approval.
3. Pin its **actual npm registry tarball integrity** in SRKL and Aiko,
   regenerate their lockfiles, and independently build/test/deploy both.
4. Remove legacy `LUTH_OAUTH_BFF_SECRET` Worker bindings only after
   the deployed apps use this database-backed Kloks implementation.
5. In the authenticated Luth console, enroll SRKL and Aiko using their
   canonical Worker origins. The Luth backend persists the credentials;
   no additional Worker bindings are needed.
6. Complete independent Chrome/Safari login, OIDC callback, refresh,
   logout, replay, failure and revoked-session/cross-workspace checks
   before asserting production E2E readiness.
