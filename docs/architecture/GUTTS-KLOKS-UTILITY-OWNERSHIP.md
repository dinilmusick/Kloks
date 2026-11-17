# GutTS / Kloks utility ownership

GutTS owns portable, provider-neutral `normalizeStoragePath`,
`encodeSafePathSegments` and `resolveTrustedApiUrl` under
`@dinilmusick/gutts/urls/safety`.

Kloks imports these utilities, preserving its previous public
`normalizeStoragePath` export for compatibility. Its Cloudflare, Vercel,
Google, GitHub, Dropbox and Backblaze APIs, account models, quota logic,
authorization boundaries and KrnlTS facades remain in Kloks.

GutTS 2.2.1 rejects nested encoded traversal and delimiter smuggling
without adding Node or provider SDK dependencies. Kloks's provider tests
prove that invalid paths never reach the fetch transport carrying
provider credentials. Valid GitLab encoded project names remain supported.

Kloks pins an independently released GutTS and verifies the actual
packed consumer surface and frozen lockfile before publishing.
