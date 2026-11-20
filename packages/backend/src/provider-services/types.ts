/** Canonical provider/service identity and quota contracts. No secrets are persisted here. */
export type ProviderCategory = 'suite' | 'deployment' | 'cloud' | 'ai' | 'storage' | 'developer';
export type ProviderStatus = 'ready' | 'catalogued' | 'excluded';
export type CredentialMode = 'api-token' | 'api-key' | 'oauth2' | 'application-key';
export type RenewalPolicy = 'daily' | 'weekly' | 'monthly' | 'ongoing' | 'unknown' | 'trial';

export interface FreeComputeOffer {
  providerId: string;
  allowance: string;
  renewal: RenewalPolicy;
  quotaScope: 'account' | 'workspace' | 'organization' | 'project' | 'billing-account' | 'subscription' | 'namespace';
  workload: 'vm' | 'container' | 'function' | 'gpu' | 'sandbox' | 'ci' | 'notebook' | 'browser' | 'developer';
  access: 'general' | 'restricted';
  sourceUrl: string;
  notes: string;
  verifiedDate: string;
  /** Catalogued allowance is NEVER proof of available account capacity. */
  allocationEnabled: false;
}

export interface ProviderDefinition {
  /** A suite groups related service adapters and can expose its own identity API. */
  kind?: 'suite' | 'service';
  id: string;
  name: string;
  freeCompute?: FreeComputeOffer;
  category: ProviderCategory;
  status: ProviderStatus;
  parentId?: string;
  credentialModes: readonly CredentialMode[];
  capabilities: readonly string[];
  renewal: RenewalPolicy;
  docsUrl: string;
  /** True only when a specific Kloks API implementation exists. */
  apiImplemented: boolean;
  /** True only when this service can report quota measurements, not infer them. */
  usageImplemented: boolean;
}

export type MetricSource = 'provider' | 'estimate' | 'unavailable';
export type QuotaWindow = 'minute' | 'day' | 'month' | 'billing' | 'rolling-30d';
export interface ProviderQuotaMetric {
  id: string;
  label: string;
  unit: string;
  used: number | null;
  limit: number | null;
  source: MetricSource;
  window: QuotaWindow;
  /** Only enforce when usage actually covers the corresponding quota window. */
  enforceable: boolean;
  resetAt: string | null;
}
export interface ProviderUsageSnapshot {
  providerId: string;
  serviceId: string;
  accountId: string;
  capturedAt: string;
  metrics: ProviderQuotaMetric[];
  error?: string;
  /** A provider can have a healthy API but no accessible quota telemetry. */
  coverage: 'complete' | 'partial' | 'unavailable';
}
export interface CapacityDecision {
  status: 'eligible' | 'exhausted' | 'unknown';
  weight: number;
  percentRemaining: number | null;
  bottleneck: string | null;
  reason: string;
  checkedAt: string;
}
export interface ProviderConnection {
  providerId: string;
  /** Stable vault account identifier. Never an API credential. */
  accountId: string;
  credential: string;
  accountScope?: string;
}
