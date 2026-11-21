/**
 * Target-side BackendRegistry adapter for explicitly published FOD workflows.
 *
 * This installs one command on the existing Kloks BackendFacade command path;
 * it does not create another workflow engine, registry or identity service.
 * A trusted host must resolve a fresh Luth caller and both workspace owners
 * for every message. Never derive an authorization decision from payloads,
 * sessionId, forwarded headers or cached discovery descriptors.
 */
import type {FodRuntime} from './runtime.js';
import type {FodExecutionResult} from './types.js';
import type {FodVerifiedWorkflowCaller,FodWorkflowGrantStore} from './workflowGrants.js';

export const FOD_PUBLISHED_WORKFLOW_COMMAND='fod.executePublishedWorkflow';

export interface FodPublishedWorkflowCall {
  targetAppId:string;
  targetWorkspaceId:string;
  workflowId:string;
  version:number;
  input?:unknown;
}

/** Result of host verification, not caller-provided JSON. */
export interface FodVerifiedPublishedInvocation {
  caller:FodVerifiedWorkflowCaller;
  targetAppId:string;
  targetWorkspaceId:string;
  targetAppOwnerUserId:string;
  targetWorkspaceOwnerUserId:string;
  /** Server-generated invocation identity from the one-use Luth admission. */
  invocationId:string;
  /** Authenticated Luth session identity, never the transport Message.sessionId. */
  luthSessionId:string;
  /** Trusted lineage supplied by the target host; includes prior invocations. */
  chain:readonly string[];
  /** Absolute deadline inherited from the authenticated caller or host policy. */
  deadlineAt?:number;
  signal?:AbortSignal;
}

/** Structural subset of Kloks BackendRegistry; no extra service container. */
export interface FodBackendCommandRegistry {
  registerCommand(
    domain:string,
    name:string,
    handler:(input:unknown,context?:unknown)=>Promise<unknown>,
    description?:string,
  ):unknown;
}

export interface FodPublishedWorkflowBackendOptions {
  /** Canonical app identity configured at the target, never selected by client. */
  targetAppId:string;
  grantStore:FodWorkflowGrantStore;
  /** Must validate the current Luth session and all canonical ownership records. */
  verifyInvocation:(transportContext:unknown,call:FodPublishedWorkflowCall)=>Promise<FodVerifiedPublishedInvocation>;
  /**
   * Trusted NON-CONSUMING output-time authority. Must revalidate the same
   * admitted invocation, live Luth session and exact caller/target workspace
   * and grant scope without replaying the single-use admission credential.
   */
  revalidateResult:(transportContext:unknown,call:FodPublishedWorkflowCall,admission:FodVerifiedPublishedInvocation)=>Promise<FodVerifiedPublishedInvocation>;
  /** Fresh read from the owning application's actual workflow store, not catalog rows. */
  isCurrentPublishedVersion:(call:FodPublishedWorkflowCall,verified:FodVerifiedPublishedInvocation)=>Promise<boolean>;
  /** Must construct a target-owned runtime bound to the same verified request. */
  /** Bind the ALREADY owning application workflow engine. Aiko hosts can
   * supply a structural exact-version executor, not a duplicate FOD store. */
  buildRuntime:(workspaceId:string,verified:FodVerifiedPublishedInvocation)=>Promise<Pick<FodRuntime,'executePublishedFlow'>>|Pick<FodRuntime,'executePublishedFlow'>;
  /**
   * Propagate trusted chain, deadline and abort signal to any nested calls.
   * The host must preserve these across authenticated transport boundaries.
   */
  withExecutionScope:<T>(
    verified:FodVerifiedPublishedInvocation,chain:readonly string[],signal:AbortSignal,run:()=>Promise<T>,
  )=>Promise<T>;
  maxDepth?:number;
  timeoutMs?:number;
}

function validAppId(value:unknown):value is string {
  return typeof value==='string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
}
function nonEmpty(value:unknown):value is string {
  return typeof value==='string' && value.length>0 && value.trim()===value;
}
function sameAuthenticatedScope(a:FodVerifiedPublishedInvocation,b:FodVerifiedPublishedInvocation):boolean {
  return Boolean(b && nonEmpty(b.invocationId) && nonEmpty(b.luthSessionId) &&
    a.invocationId===b.invocationId && a.luthSessionId===b.luthSessionId &&
    a.caller.userId===b.caller?.userId &&
    a.caller.appId===b.caller?.appId &&
    a.caller.workspaceId===b.caller?.workspaceId &&
    a.caller.appOwnerUserId===b.caller?.appOwnerUserId &&
    a.caller.workspaceOwnerUserId===b.caller?.workspaceOwnerUserId &&
    a.targetAppId===b.targetAppId &&
    a.targetWorkspaceId===b.targetWorkspaceId &&
    a.targetAppOwnerUserId===b.targetAppOwnerUserId &&
    a.targetWorkspaceOwnerUserId===b.targetWorkspaceOwnerUserId);
}
function parseCall(value:unknown):FodPublishedWorkflowCall {
  if (!value || typeof value!=='object' || Array.isArray(value)) {
    throw new Error('Published workflow request must be an object.');
  }
  const v=value as Record<string,unknown>;
  if (!validAppId(v.targetAppId) ||
      !nonEmpty(v.targetWorkspaceId) ||
      !nonEmpty(v.workflowId) ||
      v.workflowId==='.' || v.workflowId==='..' ||
      v.workflowId.includes('/') || v.workflowId.includes('\\') ||
      !Number.isSafeInteger(v.version) || (v.version as number)<1) {
    throw new Error('Invalid published workflow handle.');
  }
  return {
    targetAppId:v.targetAppId,
    targetWorkspaceId:v.targetWorkspaceId,
    workflowId:v.workflowId,
    version:v.version as number,
    input:v.input,
  };
}

/** Version-independent identity blocks A:v1 -> B -> A:v2 cycles. */
export function publishedWorkflowChainKey(call:Pick<FodPublishedWorkflowCall,'targetAppId'|'targetWorkspaceId'|'workflowId'>):string {
  return JSON.stringify([call.targetAppId,call.targetWorkspaceId,call.workflowId]);
}

export function registerFodPublishedWorkflowBackendCommand(
  registry:FodBackendCommandRegistry,
  options:FodPublishedWorkflowBackendOptions,
):void {
  if (!validAppId(options.targetAppId) || !options.grantStore ||
      typeof options.verifyInvocation!=='function' ||
      typeof options.revalidateResult!=='function' ||
      typeof options.isCurrentPublishedVersion!=='function' ||
      typeof options.buildRuntime!=='function' ||
      typeof options.withExecutionScope!=='function') {
    throw new Error('Published workflow host verification, runtime and scoped transport are mandatory.');
  }
  const maxDepth=options.maxDepth??8;
  const timeoutMs=options.timeoutMs??30000;
  if (!Number.isSafeInteger(maxDepth) || maxDepth<1 || maxDepth>32 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>300000) {
    throw new Error('Invalid published workflow execution limits.');
  }

  registry.registerCommand('fod','executePublishedWorkflow',async(raw,transportContext):Promise<FodExecutionResult>=>{
    const call=parseCall(raw);
    if (call.targetAppId!==options.targetAppId) {
      throw new Error('Published workflow target app mismatch.');
    }
    const verified=await options.verifyInvocation(transportContext,call);
    const caller=verified?.caller;
    if (!caller || !nonEmpty(verified.invocationId) || !nonEmpty(verified.luthSessionId) ||
        !nonEmpty(caller.userId) || !validAppId(caller.appId) ||
        !nonEmpty(caller.workspaceId) || !nonEmpty(verified.targetWorkspaceId) ||
        verified.targetAppId!==options.targetAppId ||
        verified.targetWorkspaceId!==call.targetWorkspaceId ||
        verified.targetAppOwnerUserId!==caller.userId ||
        verified.targetWorkspaceOwnerUserId!==caller.userId ||
        caller.appOwnerUserId!==caller.userId ||
        caller.workspaceOwnerUserId!==caller.userId) {
      throw new Error('Published workflow denied: verified Luth same-owner scope required.');
    }
    // The chain must be host-verified. Never use a caller-supplied lineage.
    if (!Array.isArray(verified.chain) ||
        verified.chain.some(item=>typeof item!=='string' || item.length===0)) {
      throw new Error('Verified workflow call chain is required.');
    }
    const key=publishedWorkflowChainKey(call);
    if (verified.chain.includes(key)) throw new Error('Cyclic published workflow invocation denied.');
    if (verified.chain.length>=maxDepth) throw new Error('Published workflow depth limit exceeded.');
    if (verified.signal?.aborted) throw new Error('Published workflow invocation cancelled.');

    // A descriptor is not authority. Verify the CURRENT publication and grant
    // here, and again inside the existing FodRuntime execution guard.
    const permitted=await options.grantStore.isGranted({
      appId:options.targetAppId,ownerUserId:caller.userId,
      targetWorkspaceId:call.targetWorkspaceId,workflowId:call.workflowId,
      version:call.version,callerAppId:caller.appId,
      sourceWorkspaceId:caller.workspaceId,callerUserId:caller.userId,
    });
    if (!permitted) throw new Error('Published workflow denied: no active owner grant.');

    const now=Date.now();
    const inherited=verified.deadlineAt===undefined ? now+timeoutMs : verified.deadlineAt;
    if (!Number.isFinite(inherited) || inherited<=now) throw new Error('Published workflow deadline exceeded.');
    const duration=Math.max(1,Math.min(timeoutMs,inherited-now));
    const controller=new AbortController();
    const onAbort=()=>controller.abort();
    verified.signal?.addEventListener('abort',onAbort,{once:true});
    const timeout=setTimeout(()=>controller.abort(),duration);
    const nextChain=[...verified.chain,key];
    try {
      const runtime=await options.buildRuntime(call.targetWorkspaceId,verified);
      if (controller.signal.aborted) throw new Error('Published workflow cancelled or deadline exceeded.');
      // Fail closed unless the target runtime has its own per-call Luth/grant
      // guard. executePublishedFlow reloads the exact workspace revision
      // AFTER that authorization, rejecting withdrawn or outdated versions.
      const result=await options.withExecutionScope(
        verified,nextChain,controller.signal,
        ()=>runtime.executePublishedFlow(call.workflowId,call.version,call.input,{signal:controller.signal}),
      );
      if (controller.signal.aborted) throw new Error('Published workflow cancelled or deadline exceeded.');
      // A single-use admission cannot be consumed twice. The owning host
      // must use Luth's independent non-consuming revalidation authority at
      // output time and bind it to this exact admitted invocation/session.
      const atOutput=await options.revalidateResult(transportContext,call,verified);
      if (!sameAuthenticatedScope(verified,atOutput)) {
        throw new Error('Published workflow result denied: Luth session or invocation scope changed.');
      }
      if (controller.signal.aborted) throw new Error('Published workflow cancelled or deadline exceeded.');
      // A revocation or withdrawal that raced the engine MUST suppress its
      // output, even when execution itself already completed successfully.
      const stillGranted=await options.grantStore.isGranted({
        appId:options.targetAppId,ownerUserId:atOutput.caller.userId,
        targetWorkspaceId:call.targetWorkspaceId,workflowId:call.workflowId,
        version:call.version,callerAppId:atOutput.caller.appId,
        sourceWorkspaceId:atOutput.caller.workspaceId,callerUserId:atOutput.caller.userId,
      });
      if (!stillGranted) throw new Error('Published workflow result denied: grant revoked or publication withdrawn.');
      if (!await options.isCurrentPublishedVersion(call,atOutput)) {
        throw new Error('Published workflow result denied: owning revision withdrawn or replaced.');
      }
      if (controller.signal.aborted) throw new Error('Published workflow cancelled or deadline exceeded.');
      return result;
    } finally {
      clearTimeout(timeout);
      verified.signal?.removeEventListener('abort',onAbort);
    }
  },'Execute a pinned published workflow at its owning application after fresh owner/grant checks.');
}
