import { SMALL_SCRIPT_NODE } from './smallScript.js';
import type {FodEndpointDescriptor,FodExecutionResult,FodFlow,FodNodeDefinition,FodRuntimeOptions} from './types.js';
import {FodFlowStore} from './flowStore.js';
import {validateFodWorkflowGrantScope,type FodWorkflowGrantApproval} from './workflowGrants.js';
import {executeFodFlow} from './executor.js';

export class FodRuntime {
  readonly flowStore:FodFlowStore;
  private endpoints=new Map<string,FodEndpointDescriptor>();
  private nodes:FodNodeDefinition[]=[];

  constructor(private readonly options:FodRuntimeOptions) {
    this.flowStore=new FodFlowStore(options.workspaceService,options.publication);
  }

  setEndpoints(endpoints:FodEndpointDescriptor[],nodes:FodNodeDefinition[]=[]):void {
    this.endpoints=new Map(endpoints.map(endpoint=>[endpoint.id,endpoint]));
    this.nodes=nodes;
  }

  getNodeDefinitions():FodNodeDefinition[]{return [SMALL_SCRIPT_NODE,...this.nodes.filter(node=>node.type!==SMALL_SCRIPT_NODE.type)];}
  getEndpoints():FodEndpointDescriptor[]{return [...this.endpoints.values()];}

  async listFlows():Promise<FodFlow[]> { return this.flowStore.list(this.options.workspaceId); }
  async getFlow(flowId:string,version?:number):Promise<FodFlow|null> { return this.flowStore.get(this.options.workspaceId,flowId,version); }
  async saveFlow(flow:FodFlow):Promise<FodFlow> { return this.flowStore.save(this.options.workspaceId,flow); }
  async deleteFlow(flowId:string):Promise<boolean> { return this.flowStore.delete(this.options.workspaceId,flowId); }
  async publishFlow(flowId:string):Promise<FodFlow> {
    if (!this.options.authorizePublication) throw new Error('Publication authorization not configured.');
    await this.options.authorizePublication('publish',this.options.workspaceId,flowId);
    return this.flowStore.publish(this.options.workspaceId,flowId);
  }
  async unpublishFlow(flowId:string):Promise<boolean> {
    if (!this.options.authorizePublication) throw new Error('Publication authorization not configured.');
    await this.options.authorizePublication('unpublish',this.options.workspaceId,flowId);
    return this.flowStore.unpublish(this.options.workspaceId,flowId);
  }

  private async authorizeWorkflowGrant(
    action:'grant'|'revoke',
    flowId:string,
    callerAppId:string,
    sourceWorkspaceId:string,
  ):Promise<{appId:string;ownerUserId:string;targetWorkspaceId:string;workflowId:string;callerAppId:string;sourceWorkspaceId:string}> {
    const publication=this.options.publication;
    if (!publication) throw new Error('Workflow grant authority is not configured.');
    if (!this.options.workflowGrantStore) throw new Error('Workflow grant store is not configured.');
    if (!this.options.authorizeWorkflowGrant) throw new Error('Workflow grant authorization not configured.');
    const scope={
      appId:publication.appId,
      ownerUserId:publication.ownerUserId,
      targetWorkspaceId:this.options.workspaceId,
      workflowId:flowId,
      callerAppId,
      sourceWorkspaceId,
    };
    validateFodWorkflowGrantScope(scope);
    const approval:FodWorkflowGrantApproval=await this.options.authorizeWorkflowGrant({...scope,action});
    const sameOwner=[
      approval.userId,
      approval.targetAppOwnerUserId,
      approval.targetWorkspaceOwnerUserId,
      approval.callerAppOwnerUserId,
      approval.sourceWorkspaceOwnerUserId,
    ].every(owner=>typeof owner==='string' && owner===publication.ownerUserId);
    const exactScope=
      approval.targetAppId===scope.appId &&
      approval.targetWorkspaceId===scope.targetWorkspaceId &&
      approval.callerAppId===scope.callerAppId &&
      approval.sourceWorkspaceId===scope.sourceWorkspaceId;
    if (!sameOwner || !exactScope) {
      throw new Error('Workflow grant denied: v1 requires the same verified Luth owner and exact approved app/workspace scope.');
    }
    return scope;
  }

  /** Grant one currently published version to an app/workspace owned by the same Luth principal. */
  async grantFlow(flowId:string,callerAppId:string,sourceWorkspaceId:string):Promise<{
    workflowId:string;version:number;callerAppId:string;sourceWorkspaceId:string;targetWorkspaceId:string;state:'active'
  }> {
    const scope=await this.authorizeWorkflowGrant('grant',flowId,callerAppId,sourceWorkspaceId);
    // Read the workspace's current published version without trusting an index row.
    const latest=await this.flowStore.get(scope.targetWorkspaceId,flowId);
    if (!latest) throw new Error('Cannot grant a missing or retired workflow.');
    const published=await this.flowStore.getCurrentPublishedRevision(scope.targetWorkspaceId,flowId,latest.version);
    if (!published) throw new Error('Cannot grant an unpublished or stale workflow version.');
    await this.options.workflowGrantStore!.grant({...scope,version:published.version});
    return {
      workflowId:published.id,version:published.version,callerAppId,
      sourceWorkspaceId,targetWorkspaceId:scope.targetWorkspaceId,state:'active',
    };
  }

  /** Revokes every version of the exact caller app/source workspace scope. */
  async revokeFlow(flowId:string,callerAppId:string,sourceWorkspaceId:string):Promise<boolean> {
    const scope=await this.authorizeWorkflowGrant('revoke',flowId,callerAppId,sourceWorkspaceId);
    return this.options.workflowGrantStore!.revoke(scope);
  }
  /** Host calls after authenticated startup and reconnect to replay pending metadata. */
  async reconcilePublications():Promise<number> {
    return this.flowStore.reconcilePublications(this.options.workspaceId);
  }
  async executeFlow(flowId:string,input?:unknown,options:{signal?:AbortSignal;version?:number}={}):Promise<FodExecutionResult> {
    const flow=await this.getFlow(flowId,options.version);
    if(!flow) throw new Error(`FOD flow '${flowId}'${options.version===undefined?'':` version ${options.version}`} not found.`);
    return executeFodFlow(flow,this.endpoints,this.options.onEvent,input,{scriptExecutor:this.options.scriptExecutor,signal:options.signal});
  }

  /** Remote published-workflow execution boundary for future cross-app callers.
   * Never infer authorization from catalog presence or caller-supplied headers.
   * Host MUST bind a verified Luth principal and grant checker to this runtime.
   * Only the latest, locally visible pinned revision may execute.
   */
  async executePublishedFlow(flowId:string,version:number,input?:unknown,options:{signal?:AbortSignal}={}):Promise<FodExecutionResult> {
    if (!this.options.authorizePublishedExecution) throw new Error('Target workflow authorization not configured.');
    if (!Number.isSafeInteger(version) || version<1) throw new Error('Invalid requested flow version.');
    await this.options.authorizePublishedExecution(this.options.workspaceId,flowId,version);
    // Read AFTER the awaited permission check, so an intervening withdrawal
    // or edit invalidates a stale catalog entry before execution starts.
    const flow=await this.flowStore.getCurrentPublishedRevision(this.options.workspaceId,flowId,version);
    if (!flow) throw new Error('Current workflow publication unavailable.');
    return executeFodFlow(flow,this.endpoints,this.options.onEvent,input,{scriptExecutor:this.options.scriptExecutor,signal:options.signal});
  }
}
