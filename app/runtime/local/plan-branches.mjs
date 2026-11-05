import {storedPlanArtifactFields} from '../web/planning-artifact.js';
import {implementationProfileFields} from '../web/implementation-profile.js';
import {clarificationChoiceFields} from '../web/clarification-choices.js';
import {requiredCapabilityFields} from '../web/goal-capabilities.js';
import {resolveWorkerBranchOrigin} from './worker-branch-origin.mjs';
import {randomBytes} from 'node:crypto';
import {choosePlanAlternative,validateAlternatives} from '../web/plan-alternatives.js';
import {validatePlan} from '../backend/orchestrator.mjs';
import {validateStructuredArchitecture} from '../web/architecture-schema.js';
export function createPlanBranches({store,owner,latestPlanId,canonicalPlan,blocked,currentLineage}){
 const fail=code=>{throw Error(code);};
 const inFlight=new Set();
 const valid=input=>input&&/^[a-f0-9-]{36}$/.test(input.sessionId||'')&&/^run_[A-Za-z0-9-]+$/.test(input.basePlanRunId||'')&&/^(primary|alt[1-3])$/.test(input.optionId||'');
 const discoveryValid=input=>(input.proposalRunId===undefined&&input.proposalSequence===undefined)||(/^run_[A-Za-z0-9-]+$/.test(input.proposalRunId||'')&&Number.isSafeInteger(input.proposalSequence)&&input.proposalSequence>0&&input.optionId!=='primary');
 const operationFor=input=>'branch_'+input.basePlanRunId+'_'+input.optionId+(input.proposalRunId?'_'+input.proposalRunId+'_'+input.proposalSequence:'');
 async function select(input){
  if(!input||Object.keys(input).some(k=>!['sessionId','basePlanRunId','optionId','approve','proposalRunId','proposalSequence'].includes(k))||!/^[a-f0-9-]{36}$/.test(input.sessionId||'')||!/^run_[A-Za-z0-9-]+$/.test(input.basePlanRunId||'')||!/^primary$|^alt[1-3]$/.test(input.optionId||''))fail('invalid_branch_request');
  if(input.approve!==true)fail('branch_review_required');
  const operation=operationFor(input),previous=store.db.prepare('SELECT id,session_id,owner FROM runs WHERE operation=?').get(operation);
  if(previous&&previous.owner===owner&&previous.session_id===input.sessionId&&latestPlanId(input.sessionId)===previous.id){const run=await store.getRun(previous.id,owner);return {runId:run.id,events:run.events,alreadyApplied:true};}
  const reason=blocked(input.sessionId);if(reason)fail(reason);
  if(latestPlanId(input.sessionId)!==input.basePlanRunId)fail('branch_is_stale');
  const run=await store.getRun(input.basePlanRunId,owner),saved=run?.events.find(e=>e.type==='plan.created'&&e.interactionMode==='plan');
  if(!run||run.sessionId!==input.sessionId||run.status!=='completed'||!run.usageKnown||run.reservedUsd!==0||!saved)fail('completed_plan_required');
  const base=canonicalPlan({...saved,runId:run.id},input.sessionId);if(base.legacyGoalRecovered)fail('legacy_plan_requires_review');
  const discovery=input.proposalRunId?await resolveWorkerBranchOrigin({store,owner,input,saved:base,currentLineage}):null;
  const baseTasks=validatePlan({tasks:discovery?saved.tasks:saved.branchBaseTasks||saved.tasks}),baseArchitecture=discovery?(saved.architecture||null):saved.branchBaseArchitecture===undefined?(saved.architecture||null):saved.branchBaseArchitecture;
  if(baseArchitecture)validateStructuredArchitecture(baseArchitecture);
  const alternatives=validateAlternatives(discovery?.alternatives||saved.alternatives||[],baseTasks,baseArchitecture);
  const selected=choosePlanAlternative({...base,branchBaseTasks:baseTasks,branchBaseArchitecture:baseArchitecture,alternatives},input.optionId),tasks=validatePlan({tasks:selected.tasks,architecture:selected.architecture});
  const architecture=selected.architecture||null;if(architecture)validateStructuredArchitecture(architecture);
  if(JSON.stringify(tasks)===JSON.stringify(saved.tasks)&&JSON.stringify(architecture)===JSON.stringify(saved.architecture||null))fail('branch_already_selected');
  // The primary artifact is not an alternate-specific semantic contract. Never silently reuse it.
  if(Object.hasOwn(saved,'planArtifact'))fail('branch_artifact_revision_required');
  const option=alternatives.find(a=>a.id===input.optionId),id='run_'+randomBytes(16).toString('hex'),time=new Date().toISOString();
  const plan={...requiredCapabilityFields(saved),...implementationProfileFields(saved),...storedPlanArtifactFields(saved,{...saved,tasks,architecture}),goal:base.goal,originalGoal:base.originalGoal||base.goal,originalGoalRunId:base.originalGoalRunId||run.id,...(base.goalRevision?{goalRevision:base.goalRevision}:{}),...(base.goalTitle?{goalTitle:base.goalTitle}:{}),...(base.goalSummary?{goalSummary:base.goalSummary}:{}),tasks,architecture,alternatives,branchBaseTasks:baseTasks,branchBaseArchitecture:baseArchitecture,branchSelection:{optionId:input.optionId,actor:'user',estimated:true,basis:option?.predictionBasis||option?.rationale||null},branchOf:{basePlanRunId:run.id,optionId:input.optionId,...(discovery?.provenance||{})},clarificationQuestions:saved.clarificationQuestions||[],...clarificationChoiceFields(saved),needsDesignDraft:!!saved.needsDesignDraft,sourceRevision:saved.sourceRevision||null};
  const events=[{type:'run.started',sessionId:input.sessionId,interactionMode:'plan',model:'Reviewed workflow branch',budgetReservedUsd:0},{type:'plan.created',...plan,interactionMode:'plan',summary:'Selected a proposed workflow path. Prior paths remain historical; execution and runtime approval are not carried forward.'},{type:'run.completed',meaning:'plan_ready_for_approval',execution:'not_run',tests:'not_run',verified:false}].map((e,i)=>({...e,id:id+':'+(i+1),runId:id,sequence:i+1,time}));
  store.db.exec('BEGIN IMMEDIATE');try{discovery?.assertSource();if(latestPlanId(input.sessionId)!==run.id||blocked(input.sessionId))fail('branch_boundary_changed');store.db.prepare("INSERT INTO runs(id,operation,session_id,owner,model,status,reserved,charged,started_calls,usage_known,reason,created,finished) VALUES(?,?,?,?,?,'completed',0,0,0,1,'user_selected_plan_branch',?,?)").run(id,operation,input.sessionId,owner,'Reviewed workflow branch',time,time);for(const e of events)store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(id,e.sequence,JSON.stringify(e));store.db.prepare('DELETE FROM plan_approvals WHERE session_id=?').run(input.sessionId);store.db.prepare('DELETE FROM plan_choices WHERE session_id=?').run(input.sessionId);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
  return {runId:id,events};
 }
 return {async select(input){
  if(!valid(input)||!discoveryValid(input))fail('invalid_branch_request');
  const key=operationFor(input);if(inFlight.has(key))fail('branch_selection_pending');
  inFlight.add(key);try{return await select(input);}finally{inFlight.delete(key);}
 },async status(input){
  if(!valid(input)||!discoveryValid(input)||Object.keys(input).some(k=>!['sessionId','basePlanRunId','optionId','proposalRunId','proposalSequence'].includes(k)))fail('invalid_branch_request');
  const base=store.db.prepare('SELECT session_id,owner FROM runs WHERE id=?').get(input.basePlanRunId);
  if(!base||base.owner!==owner||base.session_id!==input.sessionId)fail('completed_plan_required');
  const operation=operationFor(input);if(inFlight.has(operation))return {status:'pending'};
  const previous=store.db.prepare('SELECT id,session_id,owner FROM runs WHERE operation=?').get(operation);
  if(previous&&previous.owner===owner&&previous.session_id===input.sessionId){
   const run=await store.getRun(previous.id,owner);
   if(latestPlanId(input.sessionId)!==previous.id)return {status:'stale'};
   return {status:'applied',runId:run.id,events:run.events};
  }
  return {status:latestPlanId(input.sessionId)===input.basePlanRunId?'not_applied':'stale'};
 }};
}
