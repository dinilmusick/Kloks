# Renewable free-compute offer catalogue (research: 2026-11-20)
This catalogue is the canonical **planning** layer for Frnes and SRKL. It does not authorize credentials, register accounts, implement machine lifecycle, or prove provider quota.
- `getFreeComputeOffer()`, `listFreeComputeOffers()` and `getProviderService().freeCompute` return source-linked offer descriptors.
- `allocationEnabled: false` for **every** offer. Operational eligibility requires legitimate user-owned account access, measured complete provider usage and resets, independent authorization, provider policy review, atomic lease/reservation, and live checks.
- `access: restricted` marks notebook, CI, browser or developer-specific services that must **not** be used as generic remote compute pools.
- Quota scope (account, workspace, project, subscription, organization, namespace) is a label from product documentation, **not** permission to create multiple accounts to multiply free usage. Google Cloud terms explicitly forbid creating multiple projects/accounts to simulate one application and avoid fees or quotas: https://cloud.google.com/terms.
- `ongoing` is an always-free *resource entitlement*, **not** a refreshing credit. `weekly` is used for Kaggle only. Freestyle's currently posted pricing is **20 vCPU-hours/day**, superseding an older cached monthly claim.
- Prior Free plans and published prices can change without notice. Recheck source links before any live allocation and do not infer current capacity from this list.
- Cloudflare Pages Functions shares Workers request allowances. Google Cloud Run and Firebase Functions may share metering; do not count any quota twice. Scaleway Jobs and Containers may share account-level meters; do not add them together without billing proof.
- Some products require a card or billing account; some restrict commercial workloads, signups or regions. This source is not a promise of free compute accessible from every location.
- Vercel Sandbox is distinct from Vercel deployments; Cloudflare Browser Run is distinct from paid Containers.
- Beam/Modal GPU credit and Kaggle weekly GPU time are different service classes and cannot be substituted for a persistent VM.

## Revalidation
Use the `sourceUrl` and `verifiedDate` on each entry; check the provider's current official pricing and terms, test a real authorized token and provider-backed usage endpoint, and independently verify controls before changing `allocationEnabled` (which intentionally has the literal false type).
