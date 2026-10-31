import type {Artifact,Task,TaskContext,TaskStatus} from './types.js';

export class TaskRuntime {
  private readonly tasks=new Map<string,Task>();
  create(request:string,parentTaskId?:string):Task {
    const id=crypto.randomUUID();
    const context:TaskContext={taskId:id,parentTaskId,request,requirements:[],artifacts:[],contextId:parentTaskId};
    const task:Task={id,status:'submitted',request,context};
    this.tasks.set(id,task); return task;
  }
  get(id:string):Task|undefined{return this.tasks.get(id);}
  transition(id:string,status:TaskStatus):Task {
    const task=this.mustGet(id); task.status=status; return task;
  }
  addRequirement(id:string,requirement:TaskContext['requirements'][number]):Task {
    const task=this.mustGet(id); task.context.requirements.push(requirement);
    task.status='input-required'; return task;
  }
  addArtifact(id:string,artifact:Artifact):Task {
    const task=this.mustGet(id); task.context.artifacts.push(artifact); return task;
  }
  private mustGet(id:string):Task{const task=this.tasks.get(id);if(!task)throw new Error(`Unknown task: ${id}`);return task;}
}
