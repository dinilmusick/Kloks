/**
 * Owner-scoped workflow grants.
 *
 * Grant rows are metadata only. The workflow graph stays in the owner's
 * workspace and target execution must query the current grant on every call.
 * V1 intentionally permits same-Luth-principal app/workspace sharing only.
 */
export interface FodWorkflowGrantDescriptor {
  appId:string;
  ownerUserId:string;
  targetWorkspaceId:string;
  workflowId:string;
  version:number;
  callerAppId:string;
  sourceWorkspaceId:string;
}

export interface FodWorkflowGrantScope {
  appId:string;
  ownerUserId:string;
  targetWorkspaceId:string;
  workflowId:string;
  callerAppId:string;
  sourceWorkspaceId:string;
}

export interface FodWorkflowGrantApprovalRequest extends FodWorkflowGrantScope {
  action:'grant'|'revoke';
}

export type FodWorkflowGrantAuthorizer=(
  request:FodWorkflowGrantApprovalRequest,
)=>Promise<FodWorkflowGrantApproval>;

export interface FodWorkflowGrantQueryResult {
  rows?:readonly Record<string,unknown>[];
  rowCount?:number;
}

export type FodWorkflowGrantQuery=(sql:string,args:readonly unknown[])=>Promise<unknown>;

export interface FodWorkflowGrantStore {
  /** Creates or reactivates the exact owner-approved app/workspace grant. */
  grant(descriptor:FodWorkflowGrantDescriptor):Promise<void>;
  /** Revokes every version of the exact caller/source/target/workflow scope. */
  revoke(scope:FodWorkflowGrantScope):Promise<boolean>;
  /** Rechecks active publication and grant state for one pinned version. */
  isGranted(scope:FodWorkflowGrantDescriptor & {callerUserId:string}):Promise<boolean>;
}

export interface FodVerifiedWorkflowCaller {
  /** Current user from the verified Luth session, never a request body/header. */
  userId:string;
  /** Registered app identity resolved by the trusted host. */
  appId:string;
  /** Source workspace selected and authorized by the trusted host. */
  workspaceId:string;
  /** Canonical owner identities resolved from Luth/app registration and ACLs. */
  appOwnerUserId:string;
  workspaceOwnerUserId:string;
}

export interface FodWorkflowGrantApproval {
  /** Verified Luth principal and canonical ownership read by the host. */
  userId:string;
  targetAppOwnerUserId:string;
  targetWorkspaceOwnerUserId:string;
  callerAppOwnerUserId:string;
  sourceWorkspaceOwnerUserId:string;
}

function rowsOf(result:unknown):readonly Record<string,unknown>[] {
  if (Array.isArray(result)) return result as Record<string,unknown>[];
  if (result && typeof result==='object') {
    const candidate=result as FodWorkflowGrantQueryResult & {results?:unknown};
    if (Array.isArray(candidate.rows)) return candidate.rows;
    if (Array.isArray(candidate.results)) return candidate.results as Record<string,unknown>[];
  }
  throw new Error('Workflow grant query adapter must return PostgreSQL rows.');
}

function countOf(result:unknown):number {
  const rows=rowsOf(result);
  const raw=rows[0]?.affected ?? rows[0]?.count;
  const count=typeof raw==='number' ? raw : typeof raw==='string' ? Number(raw) : NaN;
  if (!Number.isSafeInteger(count) || count<0) {
    throw new Error('Workflow grant query did not return an affected-row count.');
  }
  return count;
}

function booleanOf(value:unknown):boolean {
  return value===true || value===1 || value==='1' || value==='t' || value==='true';
}

function nonEmpty(name:string,value:string):void {
  if (typeof value!=='string' || !value.trim()) throw new Error('Invalid workflow grant '+name+'.');
}

function canonicalAppId(name:string,value:string):void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value)) throw new Error('Invalid workflow grant '+name+'.');
}

function positiveVersion(version:number):void {
  if (!Number.isSafeInteger(version) || version<1) throw new Error('Invalid workflow grant version.');
}

export function validateFodWorkflowGrantDescriptor(d:FodWorkflowGrantDescriptor):void {
  canonicalAppId('app_id',d.appId);
  canonicalAppId('caller_app_id',d.callerAppId);
  nonEmpty('owner',d.ownerUserId);
  nonEmpty('target workspace',d.targetWorkspaceId);
  nonEmpty('source workspace',d.sourceWorkspaceId);
  nonEmpty('workflow ID',d.workflowId);
  positiveVersion(d.version);
}

export function validateFodWorkflowGrantScope(s:FodWorkflowGrantScope):void {
  canonicalAppId('app_id',s.appId);
  canonicalAppId('caller_app_id',s.callerAppId);
  nonEmpty('owner',s.ownerUserId);
  nonEmpty('target workspace',s.targetWorkspaceId);
  nonEmpty('source workspace',s.sourceWorkspaceId);
  nonEmpty('workflow ID',s.workflowId);
}

/**
 * PostgreSQL adapter for skipo_ecosystem.workflow_grants from the N5 migration.
 * The host must bind this adapter to a server-side privileged SQL connection.
 * Never pass user-provided SQL or graph content through this interface.
 */
export function createSqlFodWorkflowGrantStore(query:FodWorkflowGrantQuery):FodWorkflowGrantStore {
  return {
    async grant(d) {
      validateFodWorkflowGrantDescriptor(d);
      const sql=`
WITH target_publication AS (
  SELECT id
    FROM skipo_ecosystem.workflow_publications
   WHERE app_id=$1 AND owner_user_id=$2 AND workspace_id=$3
     AND workflow_id=$4 AND version=$5::integer
     AND publication_state='published'
   FOR SHARE
), granted AS (
  INSERT INTO skipo_ecosystem.workflow_grants
    (publication_id,owner_user_id,target_workspace_id,caller_app_id,
     source_workspace_id,granted_by_user_id,grant_state)
  SELECT id,$2,$3,$6,$7,$2,'active'
    FROM target_publication
  ON CONFLICT
    (publication_id,caller_app_id,source_workspace_id,target_workspace_id)
  DO UPDATE SET grant_state='active',revoked_at=NULL,revoked_by_user_id=NULL
  RETURNING id
)
SELECT count(*)::integer AS affected FROM granted`;
      const result=await query(sql,[
        d.appId,d.ownerUserId,d.targetWorkspaceId,d.workflowId,d.version,
        d.callerAppId,d.sourceWorkspaceId,
      ]);
      if (countOf(result)!==1) {
        throw new Error('Cannot grant access: the exact workflow version is not currently published.');
      }
    },

    async revoke(s) {
      validateFodWorkflowGrantScope(s);
      // Revoke every version in this exact scope. This makes an old cached
      // descriptor unusable even if the owner has since published a new version.
      const sql=`
WITH target_publications AS (
  SELECT id
    FROM skipo_ecosystem.workflow_publications
   WHERE app_id=$1 AND owner_user_id=$2 AND workspace_id=$3 AND workflow_id=$4
), revoked AS (
  UPDATE skipo_ecosystem.workflow_grants grant_row
     SET grant_state='revoked',
         revoked_at=clock_timestamp(),
         revoked_by_user_id=$2
   WHERE grant_row.publication_id IN (SELECT id FROM target_publications)
     AND grant_row.owner_user_id=$2
     AND grant_row.target_workspace_id=$3
     AND grant_row.caller_app_id=$5
     AND grant_row.source_workspace_id=$6
     AND grant_row.grant_state='active'
  RETURNING grant_row.id
)
SELECT count(*)::integer AS affected FROM revoked`;
      const result=await query(sql,[
        s.appId,s.ownerUserId,s.targetWorkspaceId,s.workflowId,
        s.callerAppId,s.sourceWorkspaceId,
      ]);
      return countOf(result)>0;
    },

    async isGranted(s) {
      validateFodWorkflowGrantDescriptor(s);
      nonEmpty('caller principal',s.callerUserId);
      // Cross-user delegation is outside v1 and is denied before querying.
      if (s.callerUserId!==s.ownerUserId) return false;
      const sql=`
SELECT EXISTS (
  SELECT 1
    FROM skipo_ecosystem.workflow_publications publication
    JOIN skipo_ecosystem.workflow_grants grant_row
      ON grant_row.publication_id=publication.id
   WHERE publication.app_id=$1
     AND publication.owner_user_id=$2
     AND publication.workspace_id=$3
     AND publication.workflow_id=$4
     AND publication.version=$5::integer
     AND publication.publication_state='published'
     AND grant_row.owner_user_id=publication.owner_user_id
     AND grant_row.target_workspace_id=publication.workspace_id
     AND grant_row.caller_app_id=$6
     AND grant_row.source_workspace_id=$7
     AND grant_row.granted_by_user_id=publication.owner_user_id
     AND grant_row.grant_state='active'
     AND grant_row.revoked_at IS NULL
) AS authorized`;
      const result=await query(sql,[
        s.appId,s.ownerUserId,s.targetWorkspaceId,s.workflowId,s.version,
        s.callerAppId,s.sourceWorkspaceId,
      ]);
      return booleanOf(rowsOf(result)[0]?.authorized);
    },
  };
}

/**
 * Build the target-side per-invocation authorization callback used by
 * FodRuntime.executePublishedFlow. getVerifiedCaller MUST resolve the current
 * Luth bearer/session and prove that the active app and source workspace are
 * owned by that same principal. No identity field may come from request JSON,
 * forwarded headers, or the global discovery index.
 */
export function createSqlFodPublishedWorkflowAuthorizer(options:{
  grantStore:FodWorkflowGrantStore;
  targetAppId:string;
  targetOwnerUserId:string;
  getVerifiedCaller:()=>Promise<FodVerifiedWorkflowCaller>;
}):(workspaceId:string,flowId:string,version:number)=>Promise<void> {
  canonicalAppId('app_id',options.targetAppId);
  nonEmpty('target owner',options.targetOwnerUserId);
  return async(workspaceId,flowId,version)=>{
    nonEmpty('target workspace',workspaceId);
    nonEmpty('workflow ID',flowId);
    positiveVersion(version);
    const caller=await options.getVerifiedCaller();
    nonEmpty('caller principal',caller.userId);
    canonicalAppId('caller app_id',caller.appId);
    nonEmpty('source workspace',caller.workspaceId);
    if (caller.userId!==options.targetOwnerUserId ||
        caller.appOwnerUserId!==caller.userId ||
        caller.workspaceOwnerUserId!==caller.userId) {
      throw new Error('Published workflow access denied: v1 requires the same verified Luth owner.');
    }
    const allowed=await options.grantStore.isGranted({
      appId:options.targetAppId,
      ownerUserId:options.targetOwnerUserId,
      targetWorkspaceId:workspaceId,
      workflowId:flowId,
      version,
      callerAppId:caller.appId,
      sourceWorkspaceId:caller.workspaceId,
      callerUserId:caller.userId,
    });
    if (!allowed) throw new Error('Published workflow access denied: active owner grant not found.');
  };
}
