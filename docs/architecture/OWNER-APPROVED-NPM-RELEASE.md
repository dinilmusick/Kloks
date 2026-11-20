# Owner-approved Kloks package publication

The existing `.github/workflows/npm-release.yml` is the **only** publisher: it builds,
type-checks, tests, validates packed consumers, enforces unused package version,
publishes through npm trusted publishing, and independently downloads the artifact.

If a connected GitHub client cannot directly dispatch Actions, an authenticated
repository owner can open a GitHub issue with:

- **Exact title:** `[kloks-npm-release] publish`
- **Entire body:** current immutable **Kloks main commit SHA** (40 lowercase hex).

`owner-approved-npm-release.yml` only accepts issue author id `155351357`, and
requires that the issue body equals both the initial default-branch event SHA and
the current GitHub main ref immediately before dispatching the preexisting trusted
release workflow. It never publishes directly and never accepts an arbitrary ref,
tag, branch, token, command, or script from an issue.

If main advances, open a **new** owner-authored issue using the new verified SHA.
An issue opened by any other account cannot dispatch a release. A dispatched
workflow is not itself proof of release: inspect the final `npm Release` result,
signed provenance, and independent downloaded-package verification before
changing consumer pins.

This control is intentionally in Kloks rather than ATAX: ATAX may orchestrate
verification but must not build/test private targets or serve as a release runner.
