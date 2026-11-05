/** Reorder only an already-approved bounded artifact DAG. Never cancels/retries calls. */
export function createSteering({tasks, sessionId, sourceRevision=null, signal, emit}) {
 const byId=new Map(tasks.map(t=>[t.id,t]));let target=null,phase=null,closed=false;
 const active=new Set(),done=new Set(),failed=new Set();
 const error=code=>{throw Object.assign(new Error(code),{code,status:409});};
 return {
  async request(input){
   if(closed||signal.aborted)error('run_not_active');
   if(input.sessionId!==sessionId)error('session_mismatch');
   if((input.sourceRevision||null)!==sourceRevision)error('source_revision_mismatch');
   if(!byId.has(input.targetTaskId))error('unknown_steering_target');
   if(done.has(input.targetTaskId))error('target_already_completed');
   if(active.has(input.targetTaskId))error('target_already_running');
   if(failed.has(input.targetTaskId))error('target_failed');
   if(!byId.get(input.targetTaskId).dependencies.every(id=>done.has(id)))error('target_not_ready');
   if(target)error('steering_already_pending');
   target=input.targetTaskId;phase='waiting';const requestedTarget=target;
   const requested=emit('steering.requested',{targetTaskId:requestedTarget,summary:'Steering requested within the approved plan; no additional provider calls authorized.'});
   const waiting=emit('steering.waiting',{targetTaskId:requestedTarget,activeTaskIds:[...active],summary:'Finishing active work before steering. Existing calls will not be retried.'});
   await Promise.all([requested,waiting]);
   if(closed||signal.aborted)error('run_not_active');
   return {accepted:true,status:'waiting',targetTaskId:requestedTarget,boundary:'current_wave_settled',scope:'approved_artifact_tasks_only'};
  },
  async ready(pending,completed,limit){
   if(closed||signal.aborted)error('run_not_active');
   if(active.size)error('active_workers_not_settled');
   if(target&&phase==='waiting'){phase='ready';await emit('steering.ready',{targetTaskId:target,summary:'Active work settled. The selected eligible next task will run.'});}
   let candidates=[...pending.values()];
   if(target)candidates=candidates.filter(t=>t.id===target);
   return candidates.filter(t=>t.dependencies.every(id=>completed.has(id))).slice(0,limit);
  },
  async started(id){if(closed||signal.aborted)error('run_not_active');active.add(id);if(id===target){phase='running';await emit('steering.running',{targetTaskId:id,summary:'Selected task is now authoring artifacts; execution and tests are not available in this worker.'});}},
  settled(id,success){active.delete(id);if(success)done.add(id);else failed.add(id);if(id===target&&success){target=null;phase=null;}},
  close(){closed=true;},
 };
}
