import type {FodPublicationOptions} from './publicationSync.js';
import type {FodWorkflowGrantAuthorizer,FodWorkflowGrantStore} from './workflowGrants.js';
import type {SmallScriptExecutor} from './smallScript.js';

export type FodPortDirection = 'input' | 'output';
export type FodNodeCategory = 'host-app' | 'gutts' | 'flow' | 'system';

export interface FodPort {
  id:string;
  name:string;
  direction:FodPortDirection;
  dataType:string;
  required?:boolean;
  description?:string;
  schema?:Record<string,unknown>;
}

export interface FodNodeDefinition {
  type:string;
  label:string;
  description:string;
  category:FodNodeCategory;
  group:string;
  inputs:FodPort[];
  outputs:FodPort[];
  metadata?:Record<string,unknown>;
}

export interface FodCrossAppTarget {
  /** Canonical target app identity declared by the trusted backend facade. */
  appId:string;
  /** Stable operation/agent ID in the target application. */
  agentId:string;
}

export type FodCrossAppInvoker=(
  target:FodCrossAppTarget,
  input:unknown,
  signal?:AbortSignal,
)=>Promise<unknown>;

export interface FodEndpointDescriptor {
  id:string;
  serviceId:string;
  serviceName:string;
  operationId:string;
  operationName:string;
  description?:string;
  runtime?:string;
  deployment?:string;
  inputSchema?:Record<string,unknown>;
  outputSchema?:Record<string,unknown>;
  /** Set only from trusted service/operation registration metadata. */
  targetApp?:FodCrossAppTarget;
  invoke:(input:unknown)=>Promise<unknown>;
}

export interface FodFlowNode {
  id:string;
  type:string;
  position:{x:number;y:number};
  data:Record<string,unknown>;
}

export interface FodFlowEdge {
  id:string;
  source:string;
  sourceHandle?:string;
  target:string;
  targetHandle?:string;
}

export interface FodFlow {
  id:string;
  name:string;
  description?:string;
  version:number;
  createdAt:string;
  updatedAt:string;
  nodes:FodFlowNode[];
  edges:FodFlowEdge[];
  viewport?:{x:number;y:number;zoom:number};
  metadata?:Record<string,unknown>;
}

export interface FodExecutionEvent {
  type:'flow-started'|'node-started'|'node-completed'|'node-failed'|'flow-completed';
  timestamp:number;
  flowId:string;
  nodeId?:string;
  code?:string;
  data?:unknown;
}

export interface FodExecutionResult {
  success:boolean;
  flowId:string;
  output:unknown;
  outputs:Record<string,unknown>;
  errors:Array<{nodeId?:string;message:string;code?:string}>;
  events:FodExecutionEvent[];
}

export interface FodRuntimeOptions {
  workspaceId:string;
  workspaceService:any;
  /** Canonical local app ID supplied by the trusted host. */
  appId?:string;
  /** Host closure bound to the current router-issued parent context. */
  invokeCrossApp?:FodCrossAppInvoker;
  endpoints?:FodEndpointDescriptor[];
  nodes?:FodNodeDefinition[];
  onEvent?:(event:FodExecutionEvent)=>void;
  scriptExecutor?:SmallScriptExecutor;
  publication?:FodPublicationOptions;
  /** Must check the verified Luth principal and owning workspace; defaults to DENY. */
  authorizePublication?:(action:'publish'|'unpublish',workspaceId:string,flowId:string)=>Promise<void>;
  /** Host-bound Luth principal, workspace ACL and active caller grant check. */
  authorizePublishedExecution?:(workspaceId:string,flowId:string,version:number)=>Promise<void>;
  workflowGrantStore?:FodWorkflowGrantStore;
  /** Must resolve exact app/workspace owners from Luth and deny cross-user delegation. */
  authorizeWorkflowGrant?:FodWorkflowGrantAuthorizer;
}
