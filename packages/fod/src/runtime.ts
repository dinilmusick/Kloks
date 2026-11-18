import { SMALL_SCRIPT_NODE, type SmallScriptExecutor } from './smallScript.js';
import type {FodEndpointDescriptor,FodExecutionResult,FodFlow,FodNodeDefinition} from './types.js';
import {FodFlowStore} from './flowStore.js';
import type {FodPublicationOptions} from './publicationSync.js';
import {executeFodFlow} from './executor.js';

export class FodRuntime {
  readonly flowStore:FodFlowStore;
  private endpoints=new Map<string,FodEndpointDescriptor>();
  private nodes:FodNodeDefinition[]=[];

  constructor(private readonly options:{
    workspaceId:string;workspaceService:any;
    onEvent?:(event:any)=>void;scriptExecutor?:SmallScriptExecutor;
    publication?:FodPublicationOptions;
    /** Must check the Luth principal and owning workspace; defaults to DENY. */
    authorizePublication?:(action:'publish'|'unpublish',workspaceId:string,flowId:string)=>Promise<void>;
  }) {
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
  /** Host calls after authenticated startup and reconnect to replay pending metadata. */
  async reconcilePublications():Promise<number> {
    return this.flowStore.reconcilePublications(this.options.workspaceId);
  }
  async executeFlow(flowId:string,input?:unknown,options:{signal?:AbortSignal;version?:number}={}):Promise<FodExecutionResult> {
    const flow=await this.getFlow(flowId,options.version);
    if(!flow) throw new Error(`FOD flow '${flowId}'${options.version===undefined?'':` version ${options.version}`} not found.`);
    return executeFodFlow(flow,this.endpoints,this.options.onEvent,input,{scriptExecutor:this.options.scriptExecutor,signal:options.signal});
  }
}
