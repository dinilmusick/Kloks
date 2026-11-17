/** Canonical provider/service identity and quota contracts. No secrets are persisted here. */
export type ProviderCategory = 'deployment' | 'cloud' | 'ai' | 'storage' | 'developer';
export type ProviderStatus = 'ready' | 'catalogued' | 'excluded';
export type CredentialMode = 'api-token' | 'api-key' | 'oauth2' | 'application-key';
export type RenewalPolicy = 'daily' | 'monthly' | 'ongoing' | 'unknown' | 'trial';

export interface ProviderDefinition {
  id: string;
  name: string;
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
