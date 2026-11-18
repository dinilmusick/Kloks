/**
 * Target-owned FOD publication replay for authenticated startup and reconnect.
 * A catalog entry is never authority: the owning workspace's persisted intent
 * and a newly verified Luth owner/workspace scope determine each replay.
 */
import type {FodRuntime} from './runtime.js';

export interface FodVerifiedReconciliationWorkspace {
  /** All identities below come from the trusted host, never from request JSON. */
  userId:string;
  appId:string;
  appOwnerUserId:string;
  workspaceId:string;
  workspaceOwnerUserId:string;
}

export interface FodPublicationReconcilerOptions {
  /** Host-configured immutable target application ID. */
  targetAppId:string;
  /** Return null when logged out. Resolve again for EACH startup/reconnect. */
  resolveAuthenticatedWorkspaces:()=>Promise<readonly FodVerifiedReconciliationWorkspace[]|null>;
  /** Fresh Luth and workspace ACL verification immediately before replay. */
  verifyStillAuthorized:(scope:FodVerifiedReconciliationWorkspace)=>Promise<void>;
  /** Must bind a new owning-workspace FodRuntime with a server-side sink. */
  createRuntime:(scope:FodVerifiedReconciliationWorkspace)=>Promise<Pick<FodRuntime,'reconcilePublications'>>|Pick<FodRuntime,'reconcilePublications'>;
}

function validAppId(value:unknown):value is string {
  return typeof value==='string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
}
function id(value:unknown):value is string {
  return typeof value==='string' && value.length>0 && value.trim()===value;
}

export class FodPublicationReconciler {
  private tail:Promise<void>=Promise.resolve();
  private readonly options:FodPublicationReconcilerOptions;

  constructor(options:FodPublicationReconcilerOptions) {
    this.options=options;
    if (!validAppId(options.targetAppId) ||
        typeof options.resolveAuthenticatedWorkspaces!=='function' ||
        typeof options.verifyStillAuthorized!=='function' ||
        typeof options.createRuntime!=='function') {
      throw new Error('Authenticated FOD reconciliation requires a verified host and runtime factory.');
    }
  }

  /**
   * Call after Luth/session and workspace hydration on startup or reconnect.
   * Queue rather than drop overlapping notifications: the second invocation
   * re-resolves authentication, so reconnect/logout transitions are not lost.
   * No caller-controlled workspace ID or registry handle is accepted.
   */
  reconcile():Promise<number> {
    const job=this.tail.then(()=>this.replay());
    this.tail=job.then(()=>undefined,()=>undefined);
    return job;
  }

  private async replay():Promise<number> {
    const scopes=await this.options.resolveAuthenticatedWorkspaces();
    if (scopes===null) return 0; // No published-user replay during logged-out bootstrap.
    if (!Array.isArray(scopes)) throw new Error('Invalid authenticated workspace enumeration.');

    const seen=new Set<string>();
    // Validate the complete snapshot before causing any publication side effect.
    const authorized=scopes.map(raw=>{
      if (!raw || typeof raw!=='object' || !id(raw.userId) ||
          raw.appId!==this.options.targetAppId ||
          raw.appOwnerUserId!==raw.userId ||
          !id(raw.workspaceId) || raw.workspaceOwnerUserId!==raw.userId) {
        throw new Error('FOD publication reconciliation denied: same-owner Luth scope required.');
      }
      const key=JSON.stringify([raw.userId,raw.appId,raw.workspaceId]);
      if (seen.has(key)) throw new Error('Duplicate authenticated FOD workspace.');
      seen.add(key);
      return Object.freeze({
        userId:raw.userId,appId:raw.appId,appOwnerUserId:raw.appOwnerUserId,
        workspaceId:raw.workspaceId,workspaceOwnerUserId:raw.workspaceOwnerUserId,
      });
    });

    let count=0;
    for (const scope of authorized) {
      // Authentication may have changed while an earlier workspace replayed.
      await this.options.verifyStillAuthorized(scope);
      const runtime=await this.options.createRuntime(scope);
      if (!runtime || typeof runtime.reconcilePublications!=='function') {
        throw new Error('FOD reconciliation requires an owning-workspace runtime.');
      }
      // Runtime also re-verifies per workflow before sending any metadata.
      const replayed=await runtime.reconcilePublications();
      if (!Number.isSafeInteger(replayed) || replayed<0) {
        throw new Error('Invalid FOD publication reconciliation result.');
      }
      count+=replayed;
    }
    return count;
  }
}
