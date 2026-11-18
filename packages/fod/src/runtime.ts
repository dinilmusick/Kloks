import { SMALL_SCRIPT_NODE, type SmallScriptExecutor } from './smallScript.js';
import type {FodEndpointDescriptor,FodExecutionResult,FodFlow,FodNodeDefinition} from './types.js';
import {FodFlowStore} from './flowStore.js';
import {executeFodFlow} from './executor.js';

export class FodRuntime {
  readonly flowStore:FodFlowStore;
  private endpoints=new Map<string,FodEndpointDescriptor>();
  private nodes:FodNodeDefinition[]=[];

  constructor(private readonly options:{workspaceId:string;workspaceService:any;onEvent?:(event:any)=>void;scriptExecutor?:SmallScriptExecutor}) {
    this.flowStore=new FodFlowStore(options.workspaceService);
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
  async executeFlow(flowId:string,input?:unknown,options:{signal?:AbortSignal;version?:number}={}):Promise<FodExecutionResult> {
    const flow=await this.getFlow(flowId,options.version);
    if(!flow) throw new Error(`FOD flow '${flowId}'${options.version===undefined?'':` version ${options.version}`} not found.`);
    return executeFodFlow(flow,this.endpoints,this.options.onEvent,input,{scriptExecutor:this.options.scriptExecutor,signal:options.signal});
  }
}
