# Canonical public Luth OAuth 2.1 / OpenID Connect integration

Luth is the single OAuth 2.1 / OpenID Connect issuer. Kloks provides
the canonical application backend-for-frontend (BFF). Do not introduce a
trusted-source URL catalogue, administrator application-enrollment gate,
application-owned identity provider, or copied confidential OAuth secrets.

## Open application registration

- Any application, Cloudflare Worker, server or native/desktop client can
  request its own OAuth client using the standard unauthenticated
  `POST /api/auth/oauth2/register` (RFC 7591) endpoint on Luth.
- Public clients use `token_endpoint_auth_method: none`, authorization-code
  flow, and Proof Key for Code Exchange (PKCE) with `S256`.
- A client registers its exact redirect URI. Luth verifies the redirect
  against that client's own registration during authorization and code
  exchange. This per-client redirect check is **not** a privileged-origin
  allowlist and must not be removed.
- Luth enforces state, login, consent, code validity, PKCE, refresh-token
  security, scopes, token revocation, and account authorization.
- Signed-in administrative OAuth client-management privileges are distinct
  from public dynamic registration; they do not gate application creation.
- No `luth_auth_origins`, `ultrst-apps`, `trustedOrigins`, manual origin
  approval or pre-provisioned client secret is used as an enrollment gate.

## Server application integration

Use the published `@ultrst-armada/kloks` backend auth package,
`createCanonicalApplicationOAuthBff`, and the production schema migrations
`006_kloks_oidc_bff.sql` and `007_kloks_open_oauth_registration.sql`.

Each application supplies its immutable application ID and canonical
`APP_URL`. A request origin must match its own configured `APP_URL`;
this is **self-origin integrity**, not a global trusted-origin catalogue.
The BFF discovers or creates its client through public Luth registration,
and caches only the issued client ID and server-only encryption secret in
`kloks_oidc_registrations`, keyed by application and exact redirect URI.
It never reads or requires `luth_auth_origins`, `ultrst-apps`, Luth user
admin privileges, or a preapproved client-secret registry.

`SYSTEM_DATABASE_URL_1` is required; `_2` and `_3` are optional
database failovers. Do not ship Neon URLs, app session secrets, Luth
tokens or client management credentials to browsers. The BFF controls
one-use login state, server-side encrypted tokens, first-party HttpOnly
cookies, authenticated userinfo, refresh and logout. Invalid or redirected
client registrations fail closed.

## Cloudflare Workers portability

For the 2024-10-01 Workers compatibility date, configure
`global_fetch_strictly_public` and `cache_option_enabled` in
`compatibility_flags`. Cloudflare Workers rejects Fetch API
`redirect: 'error'`, so Kloks uses `redirect: 'manual'` and rejects
non-success responses rather than following a DCR redirect.
Do not add a Cloudflare-only OAuth implementation or hardcoded
administrator-approved Worker URL.

Public `workers.dev` hostnames may have Worker-to-Worker routing
differences. Independently test the deployed server-side call to the
public Luth issuer and consider a production custom domain if Cloudflare
still returns 404; never conceal a routing failure by whitelisting origins.

## Desktop and native applications

Use a separate public OAuth client with system-browser sign-in, S256 PKCE
and a native redirect method supported by the issuer (such as a loopback
URI, where permitted). Do not embed a confidential client secret in a
desktop application. Native clients do not need an application-specific
trusted-source URL entry.

## Independent acceptance

Verify: public DCR with no administrator enrollment; rejection of invalid
redirects; authorization-code/PKCE and one-use state; authenticated
callback; refresh and revocation; logout; session isolation; denial of
cross-app or cross-workspace access; and actual desktop, Cloudflare
Worker and non-Cloudflare client behavior. A green build or a healthy
issuer endpoint alone is not end-to-end certification.
