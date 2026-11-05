// Shared bounds for planning, replay, recovery and accounting; execution concurrency remains two.
export const MAX_WORKFLOW_TASKS=48;
export const MAX_WORKFLOW_PHASES=8;
export const MAX_PHASE_TASKS=12;
export const MAX_WORKFLOW_DEPENDENCIES=MAX_WORKFLOW_TASKS-1;
export const MAX_RUN_MODEL_CALLS=MAX_WORKFLOW_TASKS+1;
export const isWorkflowTaskId=value=>typeof value==='string'&&/^t(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(value);
export const PHASE_FAILURE_REASONS=Object.freeze(['phase_required','invalid_phase','phase_title_conflict','phase_task_limit_exceeded','phase_limit_exceeded','task_limit_exceeded']);

// Phases are display/organization only. Execution order comes exclusively from
// the explicit task dependencies; grouping never creates work or completion.
export function validateWorkflowPhases(tasks){
 if(!Array.isArray(tasks))throw Error('invalid_phases');
 const grouped=tasks.some(t=>t?.phaseId!==undefined||t?.phaseTitle!==undefined);
 if(!grouped){if(tasks.length>MAX_PHASE_TASKS)throw Error('phase_required');return [];}
 const phases=new Map();
 for(const t of tasks){
  if(typeof t.phaseId!=='string'||!/^p[1-8]$/.test(t.phaseId)||typeof t.phaseTitle!=='string'||!t.phaseTitle.trim()||t.phaseTitle.length>100||/[\x00-\x1f\x7f]/.test(t.phaseTitle))throw Error('invalid_phase');
  const title=t.phaseTitle.trim(),phase=phases.get(t.phaseId);
  if(phase&&phase.title!==title)throw Error('phase_title_conflict');
  if(!phase)phases.set(t.phaseId,{id:t.phaseId,title,count:0});
  if(++phases.get(t.phaseId).count>MAX_PHASE_TASKS)throw Error('phase_task_limit_exceeded');
 }
 if(phases.size>MAX_WORKFLOW_PHASES)throw Error('phase_limit_exceeded');
 return [...phases.values()];
}
