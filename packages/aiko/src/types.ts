export type AikoSourceKind='endpoint'|'fod-flow'|'gutts-api'|'custom';

export interface AikoCrossAppTarget {
  /** Canonical target app identity from the trusted server capability catalog. */
  appId:string;
  /** Stable operation/agent identity in the target application. */
  agentId:string;
}

export type AikoCrossAppInvoker=(
  target:AikoCrossAppTarget,
  input:unknown,
  signal?:AbortSignal,
)=>Promise<unknown>;

export interface AikoIntelligenceSpec { [key:string]: unknown; }

export interface AikoTool {
  id:string;
  name:string;
  description?:string;
  inputSchema?:unknown;
  validateInput?:(input:unknown)=>readonly string[];
  execute:(input:unknown)=>Promise<unknown>;
  sourceKind:AikoSourceKind;
  sourceId:string;
}

export interface AikoAgentDefinition {
  schemaVersion:'1.0.0';
  id:string;
  name:string;
  description:string;
  agentType:'TOOL'|'ENDPOINT'|'AIKO';
  tool:AikoTool;
  intelligenceSpec:AikoIntelligenceSpec;
  intelligenceSpecId?:string;
  sourceKind:AikoSourceKind;
  sourceId:string;
  allowedToolIds?:string[];
  custom?:boolean;
}

export interface AikoCapability {
  id:string;
  name:string;
  description?:string;
  sourceKind:AikoSourceKind;
  sourceId:string;
  inputSchema?:unknown;
  validateInput?:(input:unknown)=>readonly string[];
  execute:(input:unknown)=>Promise<unknown>;
}

export type AikoNaturalLanguageCandidate =
  | { readonly status: 'inputs'; readonly input: unknown }
  | { readonly status: 'clarification'; readonly question: string };

export type AikoNaturalLanguageResult =
  | { readonly status: 'completed'; readonly output: unknown }
  | { readonly status: 'clarification'; readonly question: string; readonly issues?: readonly string[] };

export interface AikoNaturalLanguageTarget {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly intelligenceSpec: AikoIntelligenceSpec;
  readonly intelligenceSpecId?: string;
}

export interface AikoKey {
  id:string;
  providerId:string;
  label:string;
  status?:string;
  isActive?:boolean;
  emailGroup?:string;
  expiresAt?:string|null;
}

export interface AikoIntelligenceResolver {
  resolve(specId?:string, context?:{agent?:AikoAgentDefinition;tool?:AikoTool}):Promise<{spec:AikoIntelligenceSpec;specId?:string}>|{spec:AikoIntelligenceSpec;specId?:string};
}

export interface AikoKeyRuntime {
  listKeys():Promise<AikoKey[]>;
  getActiveKey(providerId:string):Promise<AikoKey|null>;
  rotateKey(providerId:string):Promise<AikoKey|null>;
  addKey?(input:{providerId:string;label:string;key:string;emailGroup?:string}):Promise<AikoKey>;
  syncFromAikoEngine():Promise<{synced:number;message?:string}>;
}

export interface AikoRuntimeOptions {
  customAgents?: AikoAgentDefinition[];
  capabilities:(()=>Promise<AikoCapability[]>|AikoCapability[])|AikoCapability[];
  resolver:AikoIntelligenceResolver;
  resolveNaturalLanguage?: (agent:AikoAgentDefinition,input:string)=>Promise<unknown>;
  parseNaturalLanguage?: (target:AikoNaturalLanguageTarget,input:string)=>Promise<AikoNaturalLanguageCandidate>;
  keys:AikoKeyRuntime;
  /** Canonical local app ID supplied by the trusted host, never request data. */
  appId?:string;
  /** Host closure bound to the active router-issued parent context. */
  invokeCrossApp?:AikoCrossAppInvoker;
}
