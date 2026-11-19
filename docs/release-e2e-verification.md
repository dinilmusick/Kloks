# ULTRST exact-head CI and npm release evidence

> Release policy (2026-11-19): reviewable CI changes do not authorize a package publication or any consumer lockfile rollout. A PR-head green check is not merged-main or production certification.

## Verified source and dependency identity

1. Read the actual PR head SHA and required main SHA from GitHub, never infer one from branch names.
2. Require `actions/checkout` to use the event's immutable PR SHA for validation or `workflow_run.head_sha` for a release triggered by successful main CI. Assert `git rev-parse HEAD` equals that SHA.
3. Hash `package.json` and committed `pnpm-lock.yaml` or `package-lock.json`; install only `pnpm install --frozen-lockfile` or `npm ci --include=optional`.
4. Require the actual build, typecheck/lint, unit/integration/security tests, packaged import tests, and any browser/Worker consumer checks to **run and succeed**. A skipped gate or a failed job without steps is not passing evidence.
5. Post-merge check must match the eventual merged commit; PR-head green does not certify a later main commit.

## Reproduce the packed consumer checks

```sh
# At an explicitly verified immutable checkout:
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
corepack pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test

# Kloks: real npm pack, independent Node consumer, Worker dry-run and published dependency imports
node scripts/clean-room-boundary.mjs

# Floks repository: real packed browser/server/Worker import consumers
pnpm test:consumer-browser
pnpm test:consumer-server

# Produce candidate artifact and retain its SHA-256
packdir="$(mktemp -d)"
npm pack --pack-destination "$packdir"
sha256sum "$packdir"/*.tgz
tar -tzf "$(find "$packdir" -maxdepth 1 -name '*.tgz' -print -quit)"
```

For Skipo run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `bash tests/smoke_published_cli.sh`, which installs a real Skipo CLI tarball in an independent consumer and exercises a generated application. Verify a historical published version separately using `SKIPO_REGISTRY_VERSION=<version> bash tests/smoke_published_cli.sh`, **without** claiming that version was built from the current source.

## npm release gate: uniqueness, Trusted Publishing and provenance

- Do not write a version already present on npm; published versions are immutable. Candidate versions must be compared against registry metadata before any approved bump.
- `npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version` returning a successful response means **do not publish**. Only an unambiguous E404 means absent; timeouts, 401/403, outages and unexpected responses must fail closed.
- A release workflow must not check out moving `main` after verifying a different SHA. Avoid scheduled or push-triggered unreviewed lockfile upgrades, implicit version bump commits or direct pushes to `main`.
- Publishing, if independently approved later, requires GitHub OIDC Trusted Publishing (`id-token: write`, trusted npm workflow match, `npm publish --provenance`); do not add a long-lived npm token.
- Re-download the **actual public npm tarball** anonymously in a clean consumer, record `npm view ... dist --json`, hash the tarball, inspect `package.json` and exported paths and compare its provenance to the verified source commit. An `npm pack --dry-run` does not prove registry availability.

At review time repository manifests declared Kloks 2.2.4, Floks 2.0.8 and Skipo 1.3.0. Proposed **patch candidates only, subject to registry uniqueness checks and explicit approval**, are Kloks 2.2.5, Floks 2.0.9 and Skipo 1.3.1. Do not release or edit consumer lockfiles in this PR.

## Failure classification

| GitHub evidence | Classification |
| --- | --- |
| Matching SHA, completed successful job, relevant executable test steps successful | Verified at PR head for those steps |
| Job failed, zero recorded steps, logs unavailable (`BlobNotFound`) | Runner/account/infrastructure unresolved; **not a code test result** |
| A test step executed and returned nonzero with logs | Actual failing test (attach command and log excerpt) |
| Skipped workflow, missing SHA or detached outcome | Unknown/not certified |

Do not infer a billing/spending-limit failure without corroborating GitHub billing or runner allocation evidence.

## FMRL / private Actions capacity

The ATAX policy forbids placing private-source targets into public FMRL Git history or ATAX CI. Only use an **authorized** disposable public FMRL runtime with clone-only credentials and no persistent private-source commits. On completion, delete any temporary CI repository and independently verify that the repository is inaccessible (HTTP 404 to the expected identity), preserving cleanup receipts. If no FMRL repository was created, record *not applicable*, not successful deletion.

## 19 November 2026 baseline (historical, check current runs again)

| Repository | Review PR | Example exact-head GitHub Actions run | Outcome |
| --- | --- | --- | --- |
| Luth | #24 | 44497284012 | Failed before step data; logs unavailable |
| Aiko | #79 (application agent) | 44498308197 | Failed before step data |
| Kone | #39 | 44497289146 | Failed before step data; logs unavailable |
| SRKL | #39 | 44497997155 | Failed before step data; logs unavailable |
| Kloks | #126 | 44498430365 | CI passed, packed consumers passed; diagnostic artifact 14516516857 |
| Floks | #56 | 44498376442 | CI passed, packed consumers passed |
| Skipo | #210 | 44497148117 | CI passed, generated Vite consumer passed; separate reconciliation check skipped |

No release/publish workflow was executed by these PR checks; successful CI does **not** independently establish downloadable new npm artifacts or npm-side Trusted Publisher configuration. Preserve full SHA and run URLs in ATAX under memory key `ultrst-agent13-ci-release-20261119`.
