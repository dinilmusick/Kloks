# Kloks 3.0.0 — single official Luth OAuth provider

**Breaking authentication release.** There is one identity and OAuth authority:
the official Luth Better Auth OAuth 2.1 / OpenID Connect provider.

- No approved deployment origins or application lookup lists.
- Any web or native client can register at Luth's public RFC 7591 endpoint
  `/api/auth/oauth2/register` without administrator enrollment.
- Kloks' application BFF self-registers an OAuth public client, stores only its
  issued client ID and a protected local encryption key in
  `kloks_oidc_registrations`, then uses authorization-code + S256 PKCE.
- Tokens are issued/validated by Luth; app-local HttpOnly sessions do not mint
  independent identities.
- Removed the old credential login facade, cross-origin session-token bridge,
  applicationOAuth[appId|origin] secret lookup, and approved-app foreign keys.

## Consumers

Update `@ultrst-armada/kloks` to `3.0.0` with a regenerated frozen lockfile.
Migrate to `createCanonicalApplicationOAuthBff`, official UserInfo verification
and app-origin sessions. Remove all old auth client/registry references rather
than adding compatibility shims. SRKL and Aiko each require independent exact-head
test/build and production deployment checks.

## Production database

The canonical Neon migration has already been applied and independently
verified in project `red-mode-38205509` (default production branch
`br-calm-glitter-ae5fen6h`). Luth's official provider is already deployed.
This package release does not grant rights to an unknown app; user consent,
registered callback matching, PKCE, token lifetime, scopes and local resource
authorization remain mandatory.

## Publishing

The old `2.2.9` registry artifact is immutable and **cannot** represent this
source commit. Publish `3.0.0` only through the existing owner-approved
exact-main npm Trusted Publishing workflow, after all exact-head CI gates pass
and the npm registry confirms this version is unused.
