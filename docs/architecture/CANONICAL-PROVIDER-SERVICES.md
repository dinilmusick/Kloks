# Kloks canonical external provider services

## Contracts and ownership

- `@ultrst-armada/kloks/provider-services` is the canonical, runtime-neutral provider
  catalogue and API client surface. Provider definitions describe capabilities; they
  do not contain account credentials or any secrets.
- SRKL/Luth owns authorization, OAuth scopes and secret storage. A consuming app
  selects a known provider service, then requests an appropriately scoped, server-side
  credential. Do not fetch the vault into frontend components.
- One Google identity can authorize separate Google service integrations, but Gemini
  API keys, Drive OAuth, and Cloud project credentials are **not interchangeable**.
- DEPM/Frnes consumes `ProviderUsageSnapshot` and
  `calculateProviderCapacity(snapshot)`. Allocation is denied (weight zero) when
  required measurements are absent, stale, estimated, or unbounded.
- Downstream apps must never maintain their own provider ID allow-list. Use
  `listRecognizedAccountServices()` for operational account types. Catalogue-only
  entries are visible to planning tools, **not** available for live credentials or routing.

## First implementations

- Cloudflare: account, Workers, Pages, generic scoped API transport, and daily
  Workers request usage via GraphQL. Free tier resets at 00:00 UTC. A Paid
  account is not scored until a real budget policy exists.
- Vercel: projects, deployments, generic scoped REST transport, and usage metric
  parsing. The usage API may not provide current billing-cycle CPU data. In that
  case, capacity remains **unknown** instead of synthesizing fake metrics.
- Google: OAuth identity profile; Gemini models API (API key); existing Kloks
  Google Drive service remains authoritative for Drive operations.
- Additional entries: Groq, Cerebras, Hugging Face, OpenRouter, Render, Railway,
  Oracle Cloud, Replit and Google Cloud Run are catalogue-only until tested
  client operations, real quota telemetry and per-account authorization exist.
- Fly.io free trial is excluded (one-time only). OpenAI and xAI are excluded
  from the renewable-free allocation pool pending verified recurring plans.

## Provider API workflow

```ts
import {
  listRecognizedAccountServices, listCloudflareWorkers,
  fetchCloudflareCapacity, calculateProviderCapacity,
} from '@ultrst-armada/kloks/provider-services';

const recognized = listRecognizedAccountServices();
// Only on a trusted backend, after SRKL has resolved a scoped credential:
const snapshot = await fetchCloudflareCapacity(
  { providerId: 'cloudflare', accountId, accountScope, credential: token },
  'free',
);
const decision = calculateProviderCapacity(snapshot);
// decision.weight === 0 when telemetry cannot prove usable capacity.
```

The generic `createProviderClient()` supports additional paths on allowlisted
provider API origins without reimplementing authentication, timeout handling,
or safe error boundaries in downstream apps. It does not expand OAuth scopes
or expose private provider routes.

## Acceptance gates before turning on automatic rotation

1. Verify a live account token and the provider's usage schema using non-secret
   fixtures; check unexpected, empty, partial, 401, 403, 429, and 5xx responses.
2. Confirm billing-cycle boundaries with the provider. Rolling-30-day usage is
   NOT automatically an enforceable billing-cycle budget.
3. Replace duplicate downstream provider operations with Kloks APIs, publish a
   verified Kloks package, and upgrade SRKL and DEPM deterministically.
4. Allocate with atomic account-level reservation/lease semantics, accounting for
   in-flight requests, burst limits, and provider-specific per-model limits.
5. Verify from independently produced evidence; do not close any ledger goal
   based solely on tests that mock the external providers.

References:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/analytics/graphql-api/
- https://vercel.com/docs/plans/hobby
- https://vercel.com/changelog/access-billing-usage-cost-data-api
- https://docs.railway.com/pricing/plans
- https://render.com/docs/free
- https://huggingface.co/docs/inference-providers/pricing
- https://fly.io/docs/about/free-trial/
