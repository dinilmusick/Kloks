/**
 * Discovery-only, same-owner projection of published FOD workflows.
 *
 * Discovery is a hint, never an execution grant. The host resolves a FRESH
 * Luth principal and exact application/workspace ownership for every call.
 * The index stores metadata, never a copy of the source graph.
 */
import type {FodFlow} from './types.js';
import type {FodWorkflowGrantStore,FodVerifiedWorkflowCaller} from './workflowGrants.js';

export interface FodVerifiedDiscoveryWorkspace {
  id:string;
  ownerUserId:string;
}
export interface FodVerifiedWorkflowDiscovery {
  /** Attested by a trusted Luth host, never client JSON or forwarded headers. */
  caller:FodVerifiedWorkflowCaller;
  targetAppId:string;
  targetAppOwnerUserId:string;
  targetWorkspaces:readonly FodVerifiedDiscoveryWorkspace[];
}
export interface FodWorkflowDiscoveryHandle {
  targetAppId:string;
  targetWorkspaceId:string;
  workflowId:string;
  version:number;
  displayName:string;
  description?:string;
}
export type FodWorkflowDiscoveryQuery=(sql:string,args:readonly unknown[])=>Promise<unknown>;

export interface FodWorkflowDiscoveryOptions {
  /** Canonical app ID configured by the target; NEVER client-supplied. */
  targetAppId:string;
  query:FodWorkflowDiscoveryQuery;
  verifyDiscovery:(trustedContext:unknown)=>Promise<FodVerifiedWorkflowDiscovery>;
  verifyStillAuthorized:(trustedContext:unknown,verified:FodVerifiedWorkflowDiscovery,workspaceId:string)=>Promise<void>;
  grantStore:Pick<FodWorkflowGrantStore,'isGranted'>;
  /** Current source-owned revision check; a cached registry row is not enough. */
  getCurrentPublishedRevision:(workspaceId:string,workflowId:string,version:number,verified:FodVerifiedWorkflowDiscovery)=>Promise<Pick<FodFlow,'id'|'version'>|null>;
}

function validAppId(value:unknown):value is string {
  return typeof value==='string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
}
function nonBlank(value:unknown):value is string {
  return typeof value==='string' && value.length>0 && value.trim()===value && !value.includes('\0');
}
function safeWorkflowId(value:unknown):value is string {
  return nonBlank(value) && value!=='.' && value!=='..' && !value.includes('/') && !value.includes('\\');
}
function positiveVersion(value:unknown):value is number {
  return typeof value==='number' && Number.isSafeInteger(value) && value>=1;
}
function queryRows(value:unknown):readonly Record<string,unknown>[] {
  if (Array.isArray(value)) return value as Record<string,unknown>[];
  if (value && typeof value==='object') {
    const result=value as {rows?:unknown;results?:unknown};
    if (Array.isArray(result.rows)) return result.rows as Record<string,unknown>[];
    if (Array.isArray(result.results)) return result.results as Record<string,unknown>[];
  }
  throw new Error('FOD publication discovery query must return PostgreSQL rows.');
}
function validateVerifiedScope(verified:FodVerifiedWorkflowDiscovery,targetAppId:string):readonly string[] {
  const caller=verified?.caller;
  if (!caller || !nonBlank(caller.userId) || !validAppId(caller.appId) ||
      !nonBlank(caller.workspaceId) || caller.appOwnerUserId!==caller.userId ||
      caller.workspaceOwnerUserId!==caller.userId ||
      verified.targetAppId!==targetAppId ||
      verified.targetAppOwnerUserId!==caller.userId ||
      !Array.isArray(verified.targetWorkspaces)) {
    throw new Error('FOD discovery denied: verified same-owner Luth app/workspace scope required.');
  }
  const seen=new Set<string>();
  for (const target of verified.targetWorkspaces) {
    if (!target || !nonBlank(target.id) ||
        target.ownerUserId!==caller.userId || seen.has(target.id)) {
      throw new Error('FOD discovery denied: target workspace scope not verified.');
    }
    seen.add(target.id);
  }
  return [...seen];
}

/** Server-side only: query scope is derived solely from verified host context. */
export function createSqlFodWorkflowDiscovery(options:FodWorkflowDiscoveryOptions):{
  discover(trustedContext:unknown):Promise<readonly FodWorkflowDiscoveryHandle[]>;
} {
  if (!validAppId(options.targetAppId) || typeof options.query!=='function' ||
      typeof options.verifyDiscovery!=='function' ||
      typeof options.verifyStillAuthorized!=='function' ||
      typeof options.getCurrentPublishedRevision!=='function' ||
      typeof options.grantStore?.isGranted!=='function') {
    throw new Error('FOD discovery requires trusted Luth ownership, active grants and owning-workspace resolution.');
  }
  return {
    async discover(trustedContext) {
      const verified=await options.verifyDiscovery(trustedContext);
      const workspaceIds=validateVerifiedScope(verified,options.targetAppId);
      if (!workspaceIds.length) return [];
      const {caller}=verified;

      // The global catalog is metadata-only. Eligibility requires an ACTIVE
      // exact source app/workspace grant and current target workspace.
      const sql=[
        'SELECT publication.app_id,publication.owner_user_id,',
        '       publication.workspace_id,publication.workflow_id,',
        '       publication.version,publication.display_name,publication.description',
        '  FROM skipo_ecosystem.workflow_publications publication',
        '  JOIN skipo_ecosystem.workflow_grants grant_row',
        '    ON grant_row.publication_id=publication.id',
        ' WHERE publication.app_id=$1',
        '   AND publication.owner_user_id=$2',
        '   AND publication.workspace_id=ANY($5::text[])',
        "   AND publication.publication_state='published'",
        '   AND grant_row.owner_user_id=publication.owner_user_id',
        '   AND grant_row.target_workspace_id=publication.workspace_id',
        '   AND grant_row.caller_app_id=$3',
        '   AND grant_row.source_workspace_id=$4',
        '   AND grant_row.granted_by_user_id=publication.owner_user_id',
        "   AND grant_row.grant_state='active'",
        '   AND grant_row.revoked_at IS NULL',
        ' ORDER BY publication.workspace_id,publication.workflow_id,publication.version',
      ].join('\n');
      const rows=queryRows(await options.query(sql,[
        options.targetAppId,caller.userId,caller.appId,caller.workspaceId,workspaceIds,
      ]));
      const handles:FodWorkflowDiscoveryHandle[]=[];
      const seen=new Set<string>();
      const allowedWorkspaces=new Set(workspaceIds);
      for (const row of rows) {
        if (!row || typeof row!=='object' ||
            row.app_id!==options.targetAppId || row.owner_user_id!==caller.userId ||
            !nonBlank(row.workspace_id) || !allowedWorkspaces.has(row.workspace_id) ||
            !safeWorkflowId(row.workflow_id) || !positiveVersion(row.version) ||
            !nonBlank(row.display_name) ||
            (row.description!==null && row.description!==undefined && typeof row.description!=='string')) {
          throw new Error('FOD publication discovery returned a malformed or unauthorized descriptor.');
        }
        const workspaceId=row.workspace_id,workflowId=row.workflow_id,version=row.version;
        const key=JSON.stringify([workspaceId,workflowId,version]);
        if (seen.has(key)) continue;
        seen.add(key);
        // A cached catalog row is not authority. Revalidate current Luth,
        // active grant and owning source revision on EVERY discovery.
        await options.verifyStillAuthorized(trustedContext,verified,workspaceId);
        const grant={
          appId:options.targetAppId,ownerUserId:caller.userId,
          targetWorkspaceId:workspaceId,workflowId,version,
          callerAppId:caller.appId,sourceWorkspaceId:caller.workspaceId,
          callerUserId:caller.userId,
        };
        if (!await options.grantStore.isGranted(grant)) continue;
        const current=await options.getCurrentPublishedRevision(
          workspaceId,workflowId,version,verified,
        );
        if (!current || current.id!==workflowId || current.version!==version) continue;
        // Reject a revocation that landed during source revision loading.
        await options.verifyStillAuthorized(trustedContext,verified,workspaceId);
        if (!await options.grantStore.isGranted(grant)) continue;

        // Whitelist metadata and pinned handle: no graph, tokens, secret data
        // or independent URL that bypasses the owning BackendFacade.
        handles.push(Object.freeze({
          targetAppId:options.targetAppId,targetWorkspaceId:workspaceId,
          workflowId,version,displayName:row.display_name,
          ...(typeof row.description==='string' ? {description:row.description} : {}),
        }));
      }
      return handles;
    },
  };
}
