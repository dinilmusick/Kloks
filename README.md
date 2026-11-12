# Kloks

Kloks stands for KrnlTS BLOcKS. It is the reusable library layer for services built on KrnlTS, including service definitions, functionalities, functionality orchestrations, and concept libraries. These assets make assembling KrnlTS services similar to building with modular blocks.


<!-- Canonical auth dependency baseline: GutTS 1.4.3 -->

<!-- GutTS 1.4.3 registry propagation check 2026-11-04 -->

<!-- auth consolidation retry 1793797410196 -->

<!-- canonical auth build retry -->

<!-- canonical auth test contract -->

## Backend runtime entrypoints

The default backend entrypoints are runtime-neutral and intended for browser/Worker-compatible consumers:

- `@kloks/backend`
- `@ultrst-armada/kloks/backend`

Node-only filesystem, database, server, and service-engine implementations are exposed through explicit adapters:

- `@kloks/backend/node` or `@ultrst-armada/kloks/backend/node`
- `@kloks/backend/storage/node` or `@ultrst-armada/kloks/backend/storage/node`
- `@kloks/backend/workspace/node` or `@ultrst-armada/kloks/backend/workspace/node`
- `@kloks/backend/services/node` or `@ultrst-armada/kloks/backend/services/node`

**Migration:** consumers that previously imported Node implementations (for example, `LocalFSAdapter`, `StorageAdapterFactory`, `WorkingWorkspaceService`, database or server services) from the default backend or storage/workspace/services barrels should change those imports to the corresponding `/node` adapter. Portable contracts and Fetch-based APIs remain on the default entrypoints. The Node adapter preserves the previous aggregate backend exports.


## Portable functions and Node adapters

The default functions entrypoint is runtime-neutral:

- `@kloks/functions`
- `@ultrst-armada/kloks/functions`

Node filesystem, file-locking, and shell/process utilities are explicit Node adapters:

- `@kloks/functions/node`
- `@ultrst-armada/kloks/functions/node`

The portable `SkipoBase` contract is available from `@kloks/functions/base` and `@ultrst-armada/kloks/functions/base`.

**Important:** the package root remains a legacy all-capabilities aggregate. For generic Node, Vercel, Cloud Run, or Cloudflare Worker backends, import the explicit `/backend` entrypoint rather than the aggregate root. Audio/MIDI remains available through `/audio-midi`, `/clock`, `/midi`, and `/osc`.
