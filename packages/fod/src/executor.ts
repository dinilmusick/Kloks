import { executeSmallScript, SmallScriptLimitError, type SmallScriptExecutor } from './smallScript.js';
import type {FodEndpointDescriptor,FodExecutionEvent,FodExecutionResult,FodFlow} from './types.js';

export async function executeFodFlow(flow:FodFlow,endpoints:Map<string,FodEndpointDescriptor>,onEvent?:(event:FodExecutionEvent)=>void,initialInput?:unknown,options:{scriptExecutor?:SmallScriptExecutor;signal?:AbortSignal}={}):Promise<FodExecutionResult> {
  const events:FodExecutionEvent[]=[];
  const errors:FodExecutionResult['errors']=[];
  const emit=(event:FodExecutionEvent)=>{events.push(event);onEvent?.(event);};

  emit({type:'flow-started',timestamp:Date.now(),flowId:flow.id});
  const outputs:Record<string,unknown>=Object.create(null);

  const incoming=(nodeId:string)=>flow.edges.filter(edge=>edge.target===nodeId);
  const remaining=new Set(flow.nodes.map(node=>node.id));
  const values=new Map<string,unknown>();

  while(remaining.size) {
    const ready=flow.nodes.filter(node=>remaining.has(node.id) && incoming(node.id).every(edge=>values.has(`${edge.source}:${edge.sourceHandle ?? 'result'}`)));
    if (!ready.length) {
      const unresolved=[...remaining].join(', ');
      const message=`Flow contains an unresolved dependency or cycle: ${unresolved}`;
      errors.push({message});
      break;
    }

    for(const node of ready) {
      if(options.signal?.aborted) { errors.push({nodeId:node.id,message:'Execution cancelled.',code:'CANCELLED'}); break; }
      remaining.delete(node.id);
      emit({type:'node-started',timestamp:Date.now(),flowId:flow.id,nodeId:node.id});
      try {
        const endpointId=String(node.data?.endpointId ?? node.data?.apiId ?? node.type.replace(/^(host|gutts)\//,''));
        const isJavaScript = node.type === 'system/javascript' || node.type === 'custom/js-block';
        const endpoint=isJavaScript ? undefined : endpoints.get(endpointId);
        if (!isJavaScript && !endpoint) throw new Error(`No executable endpoint registered for node '${node.type}'.`);

        const input:Record<string,unknown>=Object.create(null);
        if(incoming(node.id).length===0 && initialInput!==undefined) {
          if(typeof initialInput==='object' && initialInput!==null) {
            Object.assign(input,initialInput);
          } else {
            input.input=initialInput;
          }
        }
        for(const edge of incoming(node.id)) {
          input[String(edge.targetHandle ?? 'input')]=values.get(`${edge.source}:${edge.sourceHandle ?? 'result'}`);
        }
        const configured=(node.data?.inputs ?? {}) as Record<string,unknown>;
        Object.assign(input,configured);
        const result=isJavaScript
          ? await executeSmallScript(options.scriptExecutor,node.data?.code,input,options.signal)
          : await endpoint!.invoke(input);
        outputs[node.id]=result;
        values.set(`${node.id}:result`,result);
        if(result && typeof result === 'object') {
          for(const [key,value] of Object.entries(result as Record<string,unknown>)) values.set(`${node.id}:${key}`,value);
        }
        emit({type:'node-completed',timestamp:Date.now(),flowId:flow.id,nodeId:node.id,data:result});
      } catch(error) {
        const message=error instanceof Error ? error.message : String(error);
        const code=error instanceof SmallScriptLimitError ? error.code : undefined;
        errors.push({nodeId:node.id,message,...(code && {code})});
        emit({type:'node-failed',timestamp:Date.now(),flowId:flow.id,nodeId:node.id,data:message,...(code && {code})});
        break;
      }
    }
    if(errors.length) break;
  }

  const success=errors.length===0 && remaining.size===0;
  const last=flow.nodes.at(-1);
  emit({type:'flow-completed',timestamp:Date.now(),flowId:flow.id,data:{success}});
  return {success,flowId:flow.id,output:last ? outputs[last.id] : undefined,outputs,errors,events};
}
