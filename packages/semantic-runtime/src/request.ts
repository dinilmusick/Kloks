import type {Requirement} from './types.js';

export interface SemanticRequest {
  id:string; contextId:string; input:string; intent?:string;
  requirements:Requirement[]; metadata?:Record<string,unknown>;
}

export function createSemanticRequest(input:string,intent?:string):SemanticRequest{
  return {id:crypto.randomUUID(),contextId:crypto.randomUUID(),input,intent,requirements:[]};
}
