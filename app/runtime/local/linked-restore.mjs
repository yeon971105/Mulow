import {documentPlanFields,documentDesignLineageFields} from '../web/plan-document.js';
import {storedPlanArtifactFields} from '../web/planning-artifact.js';
import {hasUnsettledAccounting} from './accounting-admission.mjs';
import {implementationProfileFields} from '../web/implementation-profile.js';
import {storedPlanningReadinessFields} from '../web/planning-readiness.js';
import {clarificationChoiceFields} from '../web/clarification-choices.js';
import {requiredCapabilityFields} from '../web/goal-capabilities.js';
import {createHash,randomUUID,randomBytes} from 'node:crypto';

// A SQLite journal gates the session while the separately durable source
// pointer and plan are reconciled. No runtime or external state is rewound.
const owner='local-musepilot-user',runId=v=>typeof v==='string'&&/^run_[A-Za-z0-9-]+$/.test(v),hash=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
export function createLinkedRestore({store,projects,latestPlanId,canonicalPlan,validatePlan,validateArchitecture,validateGoalMetadata,goalTransitions,activeRuns,accountingExemption=()=>null,checkDocumentRestore=()=>true,restoreDocumentDesign=()=>true}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS linked_restores(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,target_run_id TEXT NOT NULL,target_revision TEXT NOT NULL,target_plan_id TEXT NOT NULL,base_plan_id TEXT NOT NULL,previous_revision TEXT NOT NULL,previous_hash TEXT NOT NULL,source_preview_id TEXT NOT NULL,status TEXT NOT NULL,new_plan_id TEXT,created TEXT NOT NULL,finished TEXT)`);
 const pending=sessionId=>typeof sessionId==='string'&&!!db.prepare("SELECT 1 FROM linked_restores WHERE owner=? AND session_id=? AND status IN ('applying','unconfirmed') LIMIT 1").get(owner,sessionId);
 const owned=(id,sessionId)=>{const row=db.prepare('SELECT * FROM linked_restores WHERE id=? AND owner=? AND session_id=?').get(id,owner,sessionId);if(!row)fail('linked_restore_not_found');return row;};
 const idle=sessionId=>{
  if(activeRuns.size||hasUnsettledAccounting(db,{exemption:accountingExemption(sessionId)}))fail('active_or_unsettled_run');
  if(db.prepare("SELECT 1 FROM project_runtime_operations WHERE owner=? AND status IN ('starting','ready','stopping','interrupted','stop_failed') LIMIT 1").get(owner))fail('owned_runtime_must_be_stopped');
  if(goalTransitions.blocksRun(sessionId))fail('goal_change_pending');
 };
 const savedPlan=(id,sessionId)=>{
  const row=db.prepare("SELECT id,status FROM runs WHERE id=? AND owner=? AND session_id=?").get(id,owner,sessionId),rows=db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(id);
  const plans=rows.map(x=>JSON.parse(x.payload)).filter(e=>e.type==='plan.created'&&e.interactionMode==='plan');if(!row||row.status!=='completed'||plans.length!==1)fail('saved_plan_unavailable');
  const p=plans[0],base=canonicalPlan({...p,runId:id},sessionId);if(base.legacyGoalRecovered)fail('legacy_plan_requires_review');
  try{const tasks=validatePlan({tasks:p.tasks});if(JSON.stringify(tasks)!==JSON.stringify(p.tasks))throw Error('tasks');if(p.architecture)validateArchitecture(p.architecture);validateGoalMetadata(p);}catch{fail('saved_plan_invalid');}
  checkDocumentRestore({sessionId,sourcePlanRunId:id,plan:p});return {p,base};
 };
 const checkTarget=(input,{allowPending=false}={})=>{
  if(!/^[a-f0-9-]{36}$/.test(input.sessionId||'')||!runId(input.targetRunId)||!runId(input.targetPlanRunId)||!runId(input.basePlanRunId)||!/^[a-f0-9]{64}$/.test(input.targetRevision||''))fail('invalid_linked_restore');
  if(!allowPending&&pending(input.sessionId))fail('linked_restore_unconfirmed');idle(input.sessionId);
  if(latestPlanId(input.sessionId)!==input.basePlanRunId)fail('plan_is_stale');
  const {p,base}=savedPlan(input.targetPlanRunId,input.sessionId),target=projects.readSnapshot({owner,sessionId:input.sessionId,runId:input.targetRunId,revision:input.targetRevision});
  const lineage=projects.listLineage({sessionId:input.sessionId,owner}).find(x=>x.runId===input.targetRunId&&x.revision===input.targetRevision);if(!lineage||(target.planRunId!==input.targetPlanRunId&&!lineage.restoredPlanRunIds?.includes(input.targetPlanRunId)))fail('source_plan_binding_mismatch');
  const original=savedPlan(target.planRunId,input.sessionId),digest=hash(JSON.stringify({planRunId:target.planRunId,planChoice:null,tasks:original.p.tasks,architecture:original.p.architecture||null,goal:original.base.goal,sourceRevision:original.p.sourceRevision||null,...requiredCapabilityFields(original.p),...implementationProfileFields(original.p),...storedPlanArtifactFields(original.p)}));
  if(target.planRevision!==digest)fail('source_plan_digest_mismatch');
  return {p,base,target};
 };
 const planEvents=(row,p,base)=>{
  const id='run_'+randomBytes(16).toString('hex'),time=new Date().toISOString(),restoreOf={sourcePlanRunId:row.target_plan_id,previousPlanRunId:row.base_plan_id};
  const plan={goal:base.goal,originalGoal:base.originalGoal||base.goal,originalGoalRunId:base.originalGoalRunId||row.target_plan_id,...(base.goalRevision?{goalRevision:base.goalRevision}:{}),...validateGoalMetadata(p),...requiredCapabilityFields(p),...implementationProfileFields(p),...storedPlanArtifactFields(p),...storedPlanningReadinessFields(p),...documentPlanFields(p),...documentDesignLineageFields(p),tasks:p.tasks,architecture:p.architecture||null,...(p.alternatives===undefined?{}:{alternatives:p.alternatives}),...(p.branchBaseTasks?{branchBaseTasks:p.branchBaseTasks,branchBaseArchitecture:p.branchBaseArchitecture??null,branchSelection:p.branchSelection}:{}),clarificationQuestions:p.clarificationQuestions||[],...clarificationChoiceFields(p),...(p.needsDesignDraft===undefined?{}:{needsDesignDraft:!!p.needsDesignDraft}),sourceRevision:p.sourceRevision||null,restoreOf,linkedRestore:{reviewId:row.id,sourceRunId:row.target_run_id,sourceRevision:row.target_revision}};
  const events=[{type:'run.started',sessionId:row.session_id,interactionMode:'plan',model:'Restored project checkpoint',budgetReservedUsd:0},{type:'plan.created',...plan,interactionMode:'plan',summary:'Restored a linked goal, design, workflow and source. Preview is stopped; external effects were not reversed.'},{type:'run.completed',meaning:plan.clarificationQuestions.length?'plan_needs_clarification':plan.needsDesignDraft&&!plan.architecture?'plan_needs_design':'plan_ready_for_approval',execution:'not_run',tests:'not_run',verified:false}].map((e,i)=>({...e,sessionId:row.session_id,id:id+':'+(i+1),runId:id,sequence:i+1,time}));return {id,time,events};
 };
 const commit=(row,p,base)=>{
  const observed=projects.inspect({sessionId:row.session_id});if(observed.revision!==row.target_revision||observed.currentHash!==hash(row.target_revision))fail('linked_restore_unconfirmed');
  const {id,time,events}=planEvents(row,p,base);db.exec('BEGIN IMMEDIATE');try{
   if(!pending(row.session_id)||latestPlanId(row.session_id)!==row.base_plan_id)throw Error('stale');
   const sr=row.source_preview_id==='already_current'?null:db.prepare('SELECT status FROM project_source_rollbacks WHERE id=? AND owner=? AND session_id=?').get(row.source_preview_id,owner,row.session_id);if(row.source_preview_id!=='already_current'&&(!sr||!['applying','completed'].includes(sr.status)))throw Error('source audit');
   if(sr?.status==='applying')db.prepare("UPDATE project_source_rollbacks SET status='completed',finished=?,result=? WHERE id=? AND status='applying'").run(time,JSON.stringify({revision:row.target_revision,status:'reconciled',execution:'not_run'}),row.source_preview_id);
   db.prepare("INSERT INTO runs(id,operation,session_id,owner,model,status,reserved,charged,started_calls,usage_known,reason,created,finished) VALUES(?,?,?,?,?,'completed',0,0,0,1,'user_restored_plan',?,?)").run(id,'linked_restore_'+row.id,row.session_id,owner,'Restored project checkpoint',time,time);
   for(const e of events)db.prepare('INSERT INTO events VALUES(?,?,?)').run(id,e.sequence,JSON.stringify(e));restoreDocumentDesign({sessionId:row.session_id,sourcePlanRunId:row.target_plan_id,newPlanRunId:id,plan:events.find(e=>e.type==='plan.created')});db.prepare('DELETE FROM plan_approvals WHERE session_id=?').run(row.session_id);db.prepare('DELETE FROM plan_choices WHERE session_id=?').run(row.session_id);
   if(db.prepare("UPDATE linked_restores SET status='completed',new_plan_id=?,finished=? WHERE id=? AND status IN ('applying','unconfirmed')").run(id,time,row.id).changes!==1)throw Error('journal');db.exec('COMMIT');return {status:'completed',runId:id,events,sourceRevision:row.target_revision,execution:'not_run',externalActionsReversed:false};
  }catch{db.exec('ROLLBACK');fail('linked_restore_unconfirmed');}
 };
 const args=row=>({sessionId:row.session_id,targetRunId:row.target_run_id,targetRevision:row.target_revision,targetPlanRunId:row.target_plan_id,basePlanRunId:row.base_plan_id});
 return {
  pending,
  preview(input){const {target}=checkTarget(input);const current=projects.currentLineage({sessionId:input.sessionId,owner});if(current.status!=='known'||current.revision!==target.currentRevision)fail('current_source_unconfirmed');
   const lineage=projects.listLineage({sessionId:input.sessionId,owner}).find(x=>x.runId===current.runId&&x.revision===current.revision);if(!lineage)fail('current_source_unconfirmed');const previousLink=lineage.planRunId===input.basePlanRunId||lineage.restoredPlanRunIds?.includes(input.basePlanRunId)?'matched':'different';
   const p=target.currentRevision===input.targetRevision?{previewId:'already_current',currentRevision:target.currentRevision,currentHash:target.currentHash}:projects.previewRollback({owner,sessionId:input.sessionId,runId:input.targetRunId,revision:input.targetRevision}),id='linked_'+randomUUID(),time=new Date().toISOString();
   db.prepare("INSERT INTO linked_restores(id,owner,session_id,target_run_id,target_revision,target_plan_id,base_plan_id,previous_revision,previous_hash,source_preview_id,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,'previewed',?)").run(id,owner,input.sessionId,input.targetRunId,input.targetRevision,input.targetPlanRunId,input.basePlanRunId,p.currentRevision,p.currentHash,p.previewId,time);
   return {reviewId:id,sessionId:input.sessionId,targetPlanRunId:input.targetPlanRunId,targetRunId:input.targetRunId,targetRevision:input.targetRevision,previousPlanRunId:input.basePlanRunId,previousRevision:p.currentRevision,previousLink,execution:'not_run',externalActionsReversed:false};
  },
  restore({sessionId,reviewId,approve}){
   if(approve!==true)fail('linked_restore_review_required');const row=owned(reviewId,sessionId);if(row.status==='completed'){const events=db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(row.new_plan_id).map(x=>JSON.parse(x.payload));return {status:'completed',runId:row.new_plan_id,events,sourceRevision:row.target_revision,alreadyApplied:true,execution:'not_run',externalActionsReversed:false};}if(row.status!=='previewed')fail('linked_restore_unconfirmed');
   const {p,base,target}=checkTarget(args(row));if(target.currentRevision!==row.previous_revision||target.currentHash!==row.previous_hash)fail('source_changed_review_again');
   db.exec('BEGIN IMMEDIATE');try{if(pending(sessionId)||latestPlanId(sessionId)!==row.base_plan_id)throw Error('stale');idle(sessionId);if(db.prepare("UPDATE linked_restores SET status='applying' WHERE id=? AND status='previewed'").run(row.id).changes!==1)throw Error('consumed');db.prepare('DELETE FROM plan_approvals WHERE session_id=?').run(sessionId);db.prepare('DELETE FROM plan_choices WHERE session_id=?').run(sessionId);db.exec('COMMIT');}catch{db.exec('ROLLBACK');fail('linked_restore_not_admitted');}
   try{if(row.source_preview_id!=='already_current')projects.rollback({owner,sessionId,runId:row.target_run_id,revision:row.target_revision,previewId:row.source_preview_id,expectedCurrentHash:row.previous_hash,expectedCurrentRevision:row.previous_revision});return commit(row,p,base);}
   catch{try{db.prepare("UPDATE linked_restores SET status='unconfirmed' WHERE id=? AND status='applying'").run(row.id);}catch{}fail('linked_restore_unconfirmed');}
  },
  status({sessionId,reviewId}){if(!/^[a-f0-9-]{36}$/.test(sessionId||''))fail('invalid_linked_restore');const row=reviewId?owned(reviewId,sessionId):db.prepare("SELECT * FROM linked_restores WHERE owner=? AND session_id=? AND status IN ('applying','unconfirmed') ORDER BY created DESC LIMIT 1").get(owner,sessionId);if(!row)return {status:'none'};const events=row.new_plan_id?db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(row.new_plan_id).map(x=>JSON.parse(x.payload)):undefined;return {reviewId:row.id,basePlanRunId:row.base_plan_id,status:row.status,runId:row.new_plan_id||null,...(events?{events,sourceRevision:row.target_revision}:{}),targetRevision:row.target_revision,previousRevision:row.previous_revision,execution:'not_run',externalActionsReversed:false};},
  reconcile({sessionId,reviewId}){
   const row=owned(reviewId,sessionId);if(!['applying','unconfirmed'].includes(row.status))fail('linked_restore_not_pending');idle(sessionId);if(latestPlanId(sessionId)!==row.base_plan_id)fail('linked_restore_unconfirmed');
   const now=projects.inspect({sessionId});if(row.source_preview_id==='already_current'&&now.revision===row.target_revision&&now.currentHash===row.previous_hash){const {p,base}=checkTarget(args(row),{allowPending:true});return commit(row,p,base);}if(now.revision===row.previous_revision&&now.currentHash===row.previous_hash){db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE project_source_rollbacks SET status='failed',finished=? WHERE id=? AND status='applying'").run(new Date().toISOString(),row.source_preview_id);db.prepare("UPDATE linked_restores SET status='failed',finished=? WHERE id=? AND status IN ('applying','unconfirmed')").run(new Date().toISOString(),row.id);db.exec('COMMIT');return {status:'failed',sourceRevision:row.previous_revision,execution:'not_run',externalActionsReversed:false};}catch{db.exec('ROLLBACK');fail('linked_restore_unconfirmed');}}
   if(now.revision!==row.target_revision||now.currentHash!==hash(row.target_revision))fail('linked_restore_unconfirmed');
   const {p,base}=checkTarget(args(row),{allowPending:true});return commit(row,p,base);
  }
 };
}
