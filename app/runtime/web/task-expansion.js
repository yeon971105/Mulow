import {MAX_WORKFLOW_TASKS,MAX_WORKFLOW_DEPENDENCIES,isWorkflowTaskId,validateWorkflowPhases} from './workflow-limits.js';

// Proposals are inert: they neither change the approved plan nor dispatch work.
// Each proposal is independently reviewed against the exact saved base plan.
export const MAX_EXPANSION_TASKS=3;
export const MAX_EXPANSIONS_PER_RUN=3;
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const only=(v,keys)=>record(v)&&Object.keys(v).every(k=>keys.includes(k));
const safeText=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)&&!/\b(?:Bearer\s+[A-Za-z0-9._~+\/-]{8,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|(?:api[_ -]?key|password|authorization|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|cookie)\s*[:=])/i.test(v)&&!/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(v);

// The receipt records a fixed schema vocabulary, primitive types and capped
// counts. It never retains provider strings, unknown key names or task IDs.
const rootFields=['reason','tasks'];
const taskFields=['id','title','instruction','dependencies','role','outputKind','phaseId','phaseTitle'];
const kinds=['missing','null','array','object','string','number','boolean','other'];
const issues=['invalid_object','unexpected_fields','missing_field','invalid_field','task_limit','base_plan','duplicate_id','invalid_dependency','dependency_cycle','unrelated_dependency','invalid_phase','phase_title_conflict','phase_task_limit_exceeded','phase_limit_exceeded','phase_required','task_limit_exceeded','unknown'];
const kind=(v,present=true)=>!present?'missing':v===null?'null':Array.isArray(v)?'array':typeof v==='object'?'object':['string','number','boolean'].includes(typeof v)?typeof v:'other';
const types=(v,fields)=>Object.fromEntries(fields.map(k=>[k,record(v)?kind(v[k],Object.hasOwn(v,k)):'missing']));
const otherFields=(v,fields)=>record(v)?Math.min(Object.keys(v).filter(k=>!fields.includes(k)).length,4):0;
function responseShape(value){
 const tasks=record(value)&&Array.isArray(value.tasks)?value.tasks:null;
 return {kind:kind(value),fields:types(value,rootFields),otherFields:otherFields(value,rootFields),taskCount:tasks?Math.min(tasks.length,4):null,tasks:tasks?tasks.slice(0,MAX_EXPANSION_TASKS).map(t=>({kind:kind(t),fields:types(t,taskFields),otherFields:otherFields(t,taskFields)})):[]};
}
export function makeExpansionDiagnostic(value,issue='unknown',path='proposal',observed=kind(value)){
 return {version:1,issue,path,observed,shape:responseShape(value)};
}
export function validateExpansionDiagnostic(v){
 const fieldsValid=(o,fields)=>only(o,fields)&&fields.every(k=>Object.hasOwn(o,k)&&kinds.includes(o[k]));
 const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=4;
 if(!only(v,['version','issue','path','observed','shape'])||v.version!==1||!issues.includes(v.issue)||!kinds.includes(v.observed)||typeof v.path!=='string'||!/^(?:proposal(?:\.(?:reason|tasks)(?:\[[0-2]\](?:\.(?:id|title|instruction|dependencies|role|outputKind|phaseId|phaseTitle))?)?)?|approvedPlan)$/.test(v.path))throw Error('Invalid expansion diagnostic');
 const s=v.shape;
 if(!only(s,['kind','fields','otherFields','taskCount','tasks'])||!kinds.includes(s.kind)||!fieldsValid(s.fields,rootFields)||!count(s.otherFields)||!(s.taskCount===null||count(s.taskCount))||!Array.isArray(s.tasks)||s.tasks.length>MAX_EXPANSION_TASKS)throw Error('Invalid expansion diagnostic');
 if(s.taskCount===null&&s.tasks.length||s.taskCount!==null&&s.tasks.length!==Math.min(s.taskCount,MAX_EXPANSION_TASKS))throw Error('Invalid expansion diagnostic');
 for(const t of s.tasks)if(!only(t,['kind','fields','otherFields'])||!kinds.includes(t.kind)||!fieldsValid(t.fields,taskFields)||!count(t.otherFields))throw Error('Invalid expansion diagnostic');
 return structuredClone(v);
}

export function validateTaskExpansion(value,baseTasks,originTaskId){
 const fail=(issue,path,observed)=>{const e=Error('invalid_task_expansion');e.diagnostic=makeExpansionDiagnostic(value,issue,path,observed);throw e;};
 if(!record(value))fail('invalid_object','proposal',kind(value));
 if(!only(value,rootFields))fail('unexpected_fields','proposal',kind(value));
 if(!Object.hasOwn(value,'reason'))fail('missing_field','proposal.reason','missing');
 if(!safeText(value.reason,300))fail('invalid_field','proposal.reason',kind(value.reason));
 if(!Object.hasOwn(value,'tasks'))fail('missing_field','proposal.tasks','missing');
 if(!Array.isArray(value.tasks))fail('invalid_field','proposal.tasks',kind(value.tasks));
 if(value.tasks.length<1||value.tasks.length>MAX_EXPANSION_TASKS)fail('task_limit','proposal.tasks','array');
 if(!Array.isArray(baseTasks)||!baseTasks.length||baseTasks.length+value.tasks.length>MAX_WORKFLOW_TASKS)fail('base_plan','approvedPlan',kind(baseTasks));
 const baseIds=new Set(baseTasks.map(t=>t?.id));if(baseIds.size!==baseTasks.length||!baseIds.has(originTaskId))fail('base_plan','approvedPlan','array');
 const phased=baseTasks.some(t=>t?.phaseId!==undefined||t?.phaseTitle!==undefined),ids=new Set();
 for(const [i,t] of value.tasks.entries()){
  const path='proposal.tasks['+i+']';
  if(!record(t))fail('invalid_object',path,kind(t));
  if(!only(t,taskFields))fail('unexpected_fields',path,'object');
  for(const key of ['id','title','instruction','dependencies','role','outputKind',...(phased?['phaseId','phaseTitle']:[])])if(!Object.hasOwn(t,key))fail('missing_field',path+'.'+key,'missing');
  if(!isWorkflowTaskId(t.id))fail('invalid_field',path+'.id',kind(t.id));
  if(baseIds.has(t.id)||ids.has(t.id))fail('duplicate_id',path+'.id',kind(t.id));
  if(!safeText(t.title,100))fail('invalid_field',path+'.title',kind(t.title));
  if(!safeText(t.instruction,1000))fail('invalid_field',path+'.instruction',kind(t.instruction));
  if(!Array.isArray(t.dependencies)||t.dependencies.length<1||t.dependencies.length>MAX_WORKFLOW_DEPENDENCIES||new Set(t.dependencies).size!==t.dependencies.length)fail('invalid_dependency',path+'.dependencies',kind(t.dependencies));
  if(!['implementation','review','research'].includes(t.role))fail('invalid_field',path+'.role',kind(t.role));
  if(!['artifact','architecture'].includes(t.outputKind))fail('invalid_field',path+'.outputKind',kind(t.outputKind));
  if(phased||t.phaseId!==undefined||t.phaseTitle!==undefined){
   if(typeof t.phaseId!=='string'||!/^p[1-8]$/.test(t.phaseId))fail('invalid_field',path+'.phaseId',kind(t.phaseId,Object.hasOwn(t,'phaseId')));
   if(typeof t.phaseTitle!=='string'||!t.phaseTitle.trim()||t.phaseTitle.length>100||/[\x00-\x1f\x7f]/.test(t.phaseTitle))fail('invalid_field',path+'.phaseTitle',kind(t.phaseTitle,Object.hasOwn(t,'phaseTitle')));
  }
  ids.add(t.id);
 }
 const all=new Set([...baseIds,...ids]);for(const [i,t] of value.tasks.entries())if(t.dependencies.some(d=>!all.has(d)||d===t.id))fail('invalid_dependency','proposal.tasks['+i+'].dependencies','array');
 const normalized=value.tasks.map(t=>({id:t.id,title:t.title.trim(),instruction:t.instruction.trim(),dependencies:[...t.dependencies],role:t.role,outputKind:t.outputKind,...(t.phaseId!==undefined?{phaseId:t.phaseId}:{}),...(t.phaseTitle!==undefined?{phaseTitle:typeof t.phaseTitle==='string'?t.phaseTitle.trim():t.phaseTitle}:{})}));
 try{validateWorkflowPhases([...baseTasks,...normalized]);}catch(e){const issue=['invalid_phase','phase_title_conflict','phase_task_limit_exceeded','phase_limit_exceeded','phase_required','task_limit_exceeded'].includes(e.message)?e.message:'unknown';fail(issue,'proposal.tasks','array');}
 // Every new task must descend from this actual worker; reject cycles and
 // unrelated scope additions rather than guessing missing dependencies.
 const byId=new Map([...baseTasks,...normalized].map(t=>[t.id,t]));const visiting=new Set(),done=new Map();
 function descends(id){if(id===originTaskId)return true;if(!byId.has(id))return false;if(visiting.has(id))fail('dependency_cycle','proposal.tasks','array');if(done.has(id))return done.get(id);visiting.add(id);const children=byId.get(id).dependencies.map(descends);visiting.delete(id);const result=children.some(Boolean);done.set(id,result);return result;}
 for(const [i,t] of normalized.entries())if(!descends(t.id))fail('unrelated_dependency','proposal.tasks['+i+'].dependencies','array');
 return {reason:value.reason.trim(),tasks:normalized};
}
