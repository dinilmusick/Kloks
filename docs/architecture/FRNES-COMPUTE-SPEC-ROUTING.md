# Frnes Compute Spec and weighted provider routing

## Request
User selects a profile: low (1 vCPU/1 GiB), medium (2/4), high (4/8), ultra (8/16), or custom minimum CPU, RAM, GPU, disk and workload. Presets are **user requirements**, not facts about a provider.

## Matching and routing
The owning backend must enumerate only authenticated, authorized, provider-verified executable resources. Kloks `rankComputeRoutes` rejects offline resources, insufficient capabilities, wrong user/workspace, duplicates, disabled account weights, and exhausted measured capacity.

For eligible resources, compute `rawWeight = fitScore × userPreferenceWeight × normalizedRemainingQuota`. `fitScore` penalizes expensive over-provisioned resources, and the remaining fraction is the tightest complete provider-confirmed renewal metric, validated by canonical `calculateProviderCapacity`.

Probability is `rawWeight / sum(rawWeights)`. `selectComputeRoute` performs one weighted draw per request, with an injected unit random sample for independent deterministic verification. The winning resource must be independently authorized again by the provider runtime before invocation. No resident agents, process schedulers, or Frnes-specific credentials are created by this library.

User can explicitly opt into `missingUsage: 'user-weight'` for unmetered resources. Results label them `weightSource: 'user-weight'` and `remainingFraction: null`; this is **not** a claim of available free quota. With `missingUsage: 'exclude'` incomplete quota observations are excluded. Provider-confirmed exhausted quota is excluded by default, but users may explicitly choose `exhaustedUsage: 'user-weight'` to use accounts beyond free tiers or on paid plans. These results have `remainingFraction: null`, not synthetic free capacity. Stale readings are not misrepresented as measured capacity.

Free-tier catalogue offers are planning metadata, **not** executable resource attestations. Never construct `executable:true` from a catalogue record or untrusted browser body. Account grants, remaining-usage telemetry, and deploy rights remain separate verification requirements. Provider-specific account-use limits and terms still apply.
