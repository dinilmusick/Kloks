import { queryUnifiedDb } from '../core/unifiedDb.js';
import {
  getOrCreateStorageConnectionEncryptionKey, getStorageConnectionEncryptionKey,
} from '../core/systemCredentialsCore.js';
import {
  encryptSavedCredential, decryptSavedCredential,
} from './saved-account-crypto.js';
import type { ProviderSecretEnvelope, BoundSecret } from './saved-account-crypto.js';
import {
  validateSavedProviderInput, readProviderInventory,
} from './saved-account-probe.js';
import type {
  SavedProviderInput, ValidatedProviderInput, ProviderInventory,
} from './saved-account-probe.js';

type Result = { rows: Array<Record<string, any>> };
export type ProviderAccountQuery = (sql: string, params?: unknown[]) => Promise<Result>;
const defaultQuery: ProviderAccountQuery = (sql, params) => queryUnifiedDb(sql, params || []);
export interface PublicSavedProviderAccount {
  id: string;
  workspaceId: string;
  providerId: string;
  resourceKind: string;
  accountScope: string;
  projectId: string;
  region: string;
  label: string;
  enabled: boolean;
  checkedAt: string;
  createdAt: string;
}
interface SavedRow {
  id: string;
  owner_user_id: string;
  workspace_id: string;
  provider_id: string;
  resource_kind: string;
  account_scope: string;
  project_id: string;
  region: string;
  label: string;
  enabled: boolean;
  checked_at: string;
  created_at: string;
  credential_envelope: ProviderSecretEnvelope;
}
function assertOwner(owner: string): string {
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(owner))
    throw new Error('VERIFIED_OWNER_REQUIRED');
  return owner;
}
function assertWorkspace(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value))
    throw new Error('VERIFIED_WORKSPACE_REQUIRED');
  return value;
}
function assertId(id: string): string {
  if (typeof id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    throw new Error('INVALID_PROVIDER_CONNECTION_ID');
  return id;
}
function binding(row: SavedRow): BoundSecret {
  return {
    ownerUserId: row.owner_user_id, workspaceId: row.workspace_id,
    id: row.id, providerId: row.provider_id,
    resourceKind: row.resource_kind, accountScope: row.account_scope,
    projectId: row.project_id, region: row.region,
  };
}
function publicAccount(row: SavedRow): PublicSavedProviderAccount {
  return {
    id: row.id, workspaceId: row.workspace_id, providerId: row.provider_id,
    resourceKind: row.resource_kind, accountScope: row.account_scope,
    projectId: row.project_id, region: row.region, label: row.label,
    enabled: row.enabled, checkedAt: new Date(row.checked_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
export async function saveVerifiedProviderAccount(
  ownerUserId: string, workspaceId: string, input: SavedProviderInput, options: {
    query?: ProviderAccountQuery; transport?: typeof fetch;
  } = {},
): Promise<PublicSavedProviderAccount> {
  const owner = assertOwner(ownerUserId);
  const workspace = assertWorkspace(workspaceId);
  const parsed = validateSavedProviderInput(input);
  // No database row may exist until an actual provider API read succeeds.
  const proof = await readProviderInventory(parsed, options.transport);
  const query = options.query || defaultQuery;
  const key = await getOrCreateStorageConnectionEncryptionKey(query);
  const id = crypto.randomUUID();
  const row: SavedRow = {
    id, owner_user_id: owner, workspace_id: workspace,
    provider_id: parsed.providerId,
    resource_kind: parsed.resourceKind, account_scope: parsed.accountScope,
    project_id: parsed.projectId, region: parsed.region, label: parsed.label,
    enabled: true, checked_at: proof.checkedAt,
    created_at: new Date().toISOString(), credential_envelope: {
      version: 1, algorithm:'AES-GCM-256', iv:'', ciphertext:'',
    },
  };
  const envelope = await encryptSavedCredential(parsed.credential, key, binding(row));
  const result = await query(
    'INSERT INTO public.frnes_provider_accounts (id,owner_user_id,workspace_id,provider_id,resource_kind,account_scope,project_id,region,label,enabled,checked_at,credential_envelope) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,true,$10::timestamptz,$11::jsonb) RETURNING id,owner_user_id,workspace_id,provider_id,resource_kind,account_scope,project_id,region,label,enabled,checked_at,created_at',
    [id,owner,workspace,parsed.providerId,parsed.resourceKind,parsed.accountScope,
      parsed.projectId,parsed.region,parsed.label,proof.checkedAt,JSON.stringify(envelope)],
  );
  if (!result.rows[0]) throw new Error('PROVIDER_ACCOUNT_PERSISTENCE_FAILED');
  return publicAccount(result.rows[0] as SavedRow);
}
export async function listSavedProviderAccounts(
  ownerUserId: string, workspaceId: string,
  query: ProviderAccountQuery = defaultQuery,
): Promise<PublicSavedProviderAccount[]> {
  const owner = assertOwner(ownerUserId);
  const workspace = assertWorkspace(workspaceId);
  const result = await query(
    'SELECT id,owner_user_id,workspace_id,provider_id,resource_kind,account_scope,project_id,region,label,enabled,checked_at,created_at FROM public.frnes_provider_accounts WHERE owner_user_id=$1 AND workspace_id=$2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100',
    [owner,workspace],
  );
  return result.rows.map(row => publicAccount(row as SavedRow));
}
/** Server-only resolver. Never expose its return value from an HTTP API. */
async function resolveSavedProviderToken(
  ownerUserId: string, workspaceId: string, id: string,
  query: ProviderAccountQuery,
): Promise<ValidatedProviderInput> {
  const owner = assertOwner(ownerUserId);
  const workspace = assertWorkspace(workspaceId);
  assertId(id);
  const result = await query(
    'SELECT id,owner_user_id,workspace_id,provider_id,resource_kind,account_scope,project_id,region,label,enabled,checked_at,created_at,credential_envelope FROM public.frnes_provider_accounts WHERE owner_user_id=$1 AND workspace_id=$2 AND id=$3::uuid AND enabled=true AND revoked_at IS NULL LIMIT 1',
    [owner,workspace,id],
  );
  const row = result.rows[0] as SavedRow | undefined;
  if (!row) throw new Error('SAVED_PROVIDER_ACCESS_DENIED');
  const key = await getStorageConnectionEncryptionKey(query);
  const credential = await decryptSavedCredential(row.credential_envelope, key, binding(row));
  return validateSavedProviderInput({
    providerId: row.provider_id, resourceKind: row.resource_kind,
    label: row.label, accountScope: row.account_scope,
    projectId: row.project_id, region: row.region, credential,
  });
}
export async function readSavedProviderAccount(
  ownerUserId: string, workspaceId: string, id: string, options: {
    query?: ProviderAccountQuery; transport?: typeof fetch;
  } = {},
): Promise<ProviderInventory> {
  const parsed = await resolveSavedProviderToken(
    ownerUserId, workspaceId, id, options.query || defaultQuery,
  );
  return readProviderInventory(parsed, options.transport);
}
export async function revokeSavedProviderAccount(
  ownerUserId: string, workspaceId: string, id: string,
  query: ProviderAccountQuery = defaultQuery,
): Promise<boolean> {
  const owner = assertOwner(ownerUserId);
  const workspace = assertWorkspace(workspaceId);
  assertId(id);
  const result = await query(
    'UPDATE public.frnes_provider_accounts SET revoked_at=now(),enabled=false WHERE owner_user_id=$1 AND workspace_id=$2 AND id=$3::uuid AND revoked_at IS NULL RETURNING id',
    [owner,workspace,id],
  );
  return result.rows.length === 1;
}
