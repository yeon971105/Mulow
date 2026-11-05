import {MAX_WORKFLOW_TASKS,MAX_WORKFLOW_PHASES,MAX_PHASE_TASKS} from '../web/workflow-limits.js';

// Give the worker an example that can satisfy the exact current plan shape.
// The example is inert guidance: it never creates or authorizes a task.
export function expansionGuidance(tasks,originTaskId){
 const ids=new Set(tasks.map(t=>t.id));
 const unused=Array.from({length:MAX_WORKFLOW_TASKS},(_,i)=>'t'+(i+1)).find(id=>!ids.has(id));
 const phased=tasks.some(t=>t.phaseId!==undefined||t.phaseTitle!==undefined);
 const phases=new Map();for(const t of tasks)if(t.phaseId){const item=phases.get(t.phaseId)||{id:t.phaseId,title:t.phaseTitle,count:0};item.count++;phases.set(t.phaseId,item);}
 let phase=null;
 if(phased){
  const origin=tasks.find(t=>t.id===originTaskId);
  phase=[phases.get(origin?.phaseId),...phases.values()].find(p=>p&&p.count<MAX_PHASE_TASKS)||null;
  if(!phase&&phases.size<MAX_WORKFLOW_PHASES){const id=Array.from({length:MAX_WORKFLOW_PHASES},(_,i)=>'p'+(i+1)).find(x=>!phases.has(x));if(id)phase={id,title:'Additional work',count:0};}
 }
 if(!unused||tasks.length>=MAX_WORKFLOW_TASKS||!phased&&tasks.length>=MAX_PHASE_TASKS||phased&&!phase)return 'The current plan has no available task/phase slot. Do not return followUp; record the limitation in the draft.';
 const example={reason:'Why this additional work is necessary',tasks:[{id:unused,title:'Specific additional work',instruction:'Describe the required work',dependencies:[originTaskId],role:'implementation',outputKind:'artifact',...(phase?{phaseId:phase.id,phaseTitle:phase.title}:{})}]};
 const total=Math.min(3,MAX_WORKFLOW_TASKS-tasks.length,phase?MAX_PHASE_TASKS-phase.count:MAX_PHASE_TASKS-tasks.length);
 return 'Optionally, only when this task reveals genuinely necessary additional work within the approved goal and architecture, add followUp using exactly this JSON shape: '+JSON.stringify(example)+'. Use an unused t1–t48 ID for each new task, a nonempty reason, concrete title and instruction, and a dependency on this task directly or transitively. No extra fields. At most 3 new tasks; each is a proposal for later review, not permission to execute it. '+(phase?'The plan is phased: every proposed task MUST include phaseId and phaseTitle. An existing phase must use its exact title and may contain at most 12 total tasks; if needed choose an unused p1–p8 phase with a consistent title. At most '+total+' new task(s) fit in the example phase.':'The plan is unphased: omit phaseId and phaseTitle; at most '+total+' new task(s) fit in the combined unphased plan.')+' Never repeat approved tasks or add unrelated scope.';
}
