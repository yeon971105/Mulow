import {taskComponentFields,validateTaskComponentBindings,TASK_COMPONENT_GUIDANCE} from './task-components.js';
import {MAX_WORKFLOW_TASKS,MAX_WORKFLOW_DEPENDENCIES,isWorkflowTaskId,validateWorkflowPhases} from './workflow-limits.js';
import {validateStructuredArchitecture} from './architecture-schema.js';
// Alternative paths are model proposals, never progress or guarantees.
export const BRANCH_EXPLORATION_GUIDANCE='Proactively examine meaningful decision points while returning this SAME authorized planning response. Provide only genuinely viable, different workflow paths justified by the goal and constraints; no extra background calls, filler alternatives, invented measurements or execution claims. Return up to 3 alternatives anchored by taskId in the primary tasks, with id alt1 through alt3 and a concise title. Each alternative may contain tasks as a COMPLETE canonical acyclic workflow (not a patch), and optional complete structured architecture. Across alternatives, include at most 48 total task objects. Preserve unchanged task identities and interface contracts. Legacy one-task alternatives may instead provide instruction and optional componentIds for the replacement task; omission leaves that replaced task unmapped, never inherits its old targets. Include concise rationale, predictionBasis and uncertainty, optional tradeoffs (up to 5 brief strings) and estimatedEffort (text, explicitly estimated rather than measured). Mark at most one alternative recommended:true when it is preferable to the primary workflow; otherwise the primary workflow remains the recommended default. Candidates are unexecuted proposals; only the selected complete workflow may execute after normal approval. Do not manufacture alternatives when no meaningful tradeoff exists.'+' '+TASK_COMPONENT_GUIDANCE;
const normalized=v=>v.trim().replace(/\s+/g,' ').toLowerCase();
const text=(v,max)=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
const signature=v=>JSON.stringify(canonical(v));
function replacementTask(task,option){const {componentIds:oldTargets,...base}=task;return {...base,title:option.title,instruction:option.instruction,...taskComponentFields(option)};}
export function validateBranchTasks(value){
 if(!Array.isArray(value)||!value.length||value.length>MAX_WORKFLOW_TASKS)throw Error('invalid_alternative_tasks');
 const ids=new Set();const tasks=value.map(t=>{
  if(!t||typeof t!=='object'||Array.isArray(t)||!isWorkflowTaskId(t.id)||ids.has(t.id)||!text(t.title,100)||!text(t.instruction,2000)||!Array.isArray(t.dependencies)||t.dependencies.length>MAX_WORKFLOW_DEPENDENCIES||new Set(t.dependencies).size!==t.dependencies.length||!['implementation','review','research'].includes(t.role)||!['artifact','architecture'].includes(t.outputKind))throw Error('invalid_alternative_tasks');
  ids.add(t.id);return {id:t.id,title:t.title,instruction:t.instruction,dependencies:[...t.dependencies],role:t.role,outputKind:t.outputKind,...taskComponentFields(t),...(t.phaseId!==undefined?{phaseId:t.phaseId}:{}),...(t.phaseTitle!==undefined?{phaseTitle:t.phaseTitle}:{})};
 });
 for(const t of tasks)if(t.dependencies.some(d=>typeof d!=='string'||!ids.has(d)||d===t.id))throw Error('invalid_alternative_dependencies');
 validateWorkflowPhases(tasks);const done=new Set();for(let i=0;i<tasks.length;i++)for(const t of tasks)if(t.dependencies.every(d=>done.has(d)))done.add(t.id);if(done.size!==tasks.length)throw Error('cyclic_alternative');
 return tasks;
}
export function validateAlternatives(value,tasks,baseArchitecture){
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>3||!Array.isArray(tasks))throw Error('invalid_alternatives');
 const ids=new Set(),variants=new Set();let recommended=0,totalTasks=0;
 return value.map(a=>{
  if(!a||typeof a!=='object'||Array.isArray(a)||typeof a.id!=='string'||!/^alt[1-3]$/.test(a.id)||ids.has(a.id)||!tasks.some(t=>t.id===a.taskId)||!text(a.title,100)||a.tasks===undefined&&!text(a.instruction,2000)||a.instruction!==undefined&&!text(a.instruction,2000))throw Error('invalid_alternative');
  const base=tasks.find(t=>t.id===a.taskId),metadata={};if(a.tasks===undefined)Object.assign(metadata,taskComponentFields(a));
  if(a.tasks!==undefined){metadata.tasks=validateBranchTasks(a.tasks);totalTasks+=metadata.tasks.length;if(totalTasks>MAX_WORKFLOW_TASKS)throw Error('alternative_task_limit');}
  if(a.architecture!==undefined){if(a.architecture===null)throw Error('invalid_alternative_architecture');metadata.architecture=validateStructuredArchitecture(a.architecture);}
  const selectedTasks=metadata.tasks||tasks.map(t=>t.id===a.taskId?replacementTask(t,a):t);
  validateTaskComponentBindings(selectedTasks,metadata.architecture??baseArchitecture??null);
  const key=signature({tasks:selectedTasks,architecture:metadata.architecture??baseArchitecture??null});
  const duplicatePrimary=metadata.tasks?signature(metadata.tasks)===signature(tasks)&&(metadata.architecture===undefined||baseArchitecture!==undefined&&signature(metadata.architecture)===signature(baseArchitecture===null?null:validateStructuredArchitecture(baseArchitecture))):typeof base.title==='string'&&typeof base.instruction==='string'&&normalized(a.title)===normalized(base.title)&&normalized(a.instruction)===normalized(base.instruction)&&metadata.architecture===undefined;
  const legacyKey=metadata.tasks?key:signature([a.taskId,normalized(a.title),normalized(a.instruction),metadata.architecture??null]);
  if(duplicatePrimary||variants.has(legacyKey))throw Error('indistinct_alternative');ids.add(a.id);variants.add(legacyKey);
  for(const [field,max] of [['rationale',1000],['uncertainty',1000],['predictionBasis',1000],['estimatedEffort',300]])if(a[field]!==undefined){if(!text(a[field],max))throw Error('invalid_alternative_metadata');metadata[field]=a[field].trim();}
  if(a.tradeoffs!==undefined){const list=typeof a.tradeoffs==='string'?[a.tradeoffs]:a.tradeoffs;if(!Array.isArray(list)||list.length>5||list.some(v=>!text(v,300)))throw Error('invalid_alternative_metadata');metadata.tradeoffs=list.map(v=>v.trim());}
  if(a.recommended!==undefined){if(typeof a.recommended!=='boolean')throw Error('invalid_alternative_metadata');if(a.recommended&&++recommended>1)throw Error('multiple_recommended_alternatives');metadata.recommended=a.recommended;}
  return {id:a.id,taskId:a.taskId,title:a.title,...(a.instruction!==undefined?{instruction:a.instruction}:{}),...metadata,kind:'proposal',provenance:'model_proposed_not_verified'};
 });
}
export function choosePlanAlternative(plan,id){
 const baseTasks=plan.branchBaseTasks||plan.tasks,baseArchitecture=Object.hasOwn(plan,'branchBaseArchitecture')?plan.branchBaseArchitecture:plan.architecture;
 if(!Array.isArray(baseTasks))throw Error('unknown_alternative');
 if(id==='primary')return {...plan,tasks:structuredClone(baseTasks),architecture:structuredClone(baseArchitecture??null),selectedAlternative:'primary'};
 const option=plan.alternatives?.find(a=>a.id===id);
 if(!option||!baseTasks.some(t=>t.id===option.taskId))throw Error('unknown_alternative');
 return {...plan,tasks:option.tasks?structuredClone(option.tasks):baseTasks.map(t=>t.id===option.taskId?replacementTask(t,option):structuredClone(t)),architecture:structuredClone(option.architecture??baseArchitecture??null),selectedAlternative:id};
}
export function automaticPlanBranch(plan){
 const baseTasks=structuredClone(plan.branchBaseTasks||plan.tasks),baseArchitecture=structuredClone(Object.hasOwn(plan,'branchBaseArchitecture')?plan.branchBaseArchitecture:plan.architecture??null),recommended=plan.alternatives?.find(a=>a.recommended===true),optionId=recommended?.id||'primary';
 const selected=choosePlanAlternative({...plan,branchBaseTasks:baseTasks,branchBaseArchitecture:baseArchitecture},optionId);
 return {...selected,branchSelection:{optionId,actor:'model_recommendation',estimated:true,basis:recommended?.predictionBasis||recommended?.rationale||null}};
}
// A deterministic base receipt, not a model-provided proof or an execution digest.
export function alternativeBaseSignature(plan,taskId){
 const tasks=plan?.branchBaseTasks||plan?.tasks;
 if(!plan||typeof plan.goal!=='string'||!Array.isArray(tasks)||tasks.filter(t=>t?.id===taskId).length!==1)throw Error('invalid_alternative_base');
 return signature({taskId,goal:plan.goal,tasks,architecture:Object.hasOwn(plan,'branchBaseArchitecture')?plan.branchBaseArchitecture:plan.architecture??null,sourceRevision:plan.sourceRevision??null});
}
