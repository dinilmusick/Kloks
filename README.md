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

