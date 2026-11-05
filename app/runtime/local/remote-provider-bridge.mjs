import {safeSourceDiagnostic} from './remote-source-diagnostic.mjs';
import {safeProjectField} from '../web/project-diagnostics.js';
import {safeFixtureDiagnostic} from './remote-fixture-diagnostic.mjs';
import {verifyRemoteFixtureInput,publicRemoteFixture} from './remote-fixture-inputs.mjs';
// Authentication lives only in the injected memory transport. No routes, keys or URLs persisted.
import {createHash,randomUUID} from 'node:crypto';
import {validatePlan,validateArtifacts} from '../backend/orchestrator.mjs';
import {validateStructure} from '../web/structure.js';
import {validateStructuredArchitecture} from '../web/architecture-schema.js';
import {validateProject} from '../backend/project-output/contract.mjs';
export const REMOTE_STUDY_GOAL='Build a dependency-free local study planner with subject-tagged study tasks (title, subject, due date, estimated minutes), completion toggles, subject/status filtering, and a pending-minutes summary. Persist locally with restored-data validation and input/state preservation on storage failure. No accounts, external APIs, packages, calendar integrations, notifications, payments or deployment.';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,DIGEST=/^[a-f0-9]{64}$/;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const goalDigest=createHash('sha256').update(REMOTE_STUDY_GOAL).digest('hex');
const exact=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))throw Error('remote_input_invalid');};
const fail=code=>{throw Error(code);};
const revision=v=>v===null||typeof v==='string'&&DIGEST.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const immutableStates=new Set(['succeeded','failed','cancelled_not_dispatched']);
export function createRemoteProviderBridge({store,owner='local-musepilot-user',transport=null,transportStatus=()=>({connected:false}),currentContext,currentSource=()=>null,fixtures=[],assertIdle=()=>{},now=Date.now}){
 if(!store?.db||typeof currentContext!=='function')fail('remote_bridge_adapter_required');
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS remote_provider_jobs(request_id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS remote_provider_plans(run_id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,plan_request_id TEXT NOT NULL,remote_plan_digest TEXT NOT NULL,local_plan_digest TEXT NOT NULL,payload TEXT NOT NULL);');
 const fixtureFor=id=>fixtures.find(f=>f.fixtureId===id);
 const jobGoal=j=>j.fixtureId?fixtureFor(j.fixtureId)?.goal:REMOTE_STUDY_GOAL;
 const maxCalls=j=>j.kind==='plan'?1:j.resumeOf||j.repairOf?1:(j.taskCount||3)+1;
 const readiness=()=>{let s;try{s=transportStatus();}catch{return {connected:false,expiresAt:null};}return {connected:typeof transport==='function'&&s?.connected===true&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>now()&&s.expiresAt-now()<=86400000,expiresAt:Number.isSafeInteger(s?.expiresAt)?s.expiresAt:null};};
 const owned=sessionId=>{if(typeof sessionId!=='string'||!UUID.test(sessionId))fail('remote_session_invalid');if(db.prepare('SELECT 1 FROM runs WHERE session_id=? AND owner<>? LIMIT 1').get(sessionId,owner))fail('remote_session_unavailable');};
 const read=(sessionId,requestId)=>{owned(sessionId);if(!UUID.test(requestId||''))fail('remote_request_invalid');const row=db.prepare('SELECT payload FROM remote_provider_jobs WHERE request_id=? AND session_id=? AND owner=?').get(requestId,sessionId,owner);if(!row)fail('remote_request_unavailable');return JSON.parse(row.payload);};
 const write=job=>{job.updatedAt=now();db.prepare('UPDATE remote_provider_jobs SET status=?,payload=?,updated=? WHERE request_id=? AND owner=? AND session_id=?').run(job.status,JSON.stringify(job),job.updatedAt,job.requestId,owner,job.sessionId);};
 const blocked=()=>!!db.prepare("SELECT 1 FROM remote_provider_jobs WHERE owner=? AND status IN ('dispatching','running','outcome_unknown') LIMIT 1").get(owner);
 function context(sessionId){owned(sessionId);const c=currentContext(sessionId);if(!c||!revision(c.sourceRevision))fail('remote_context_unavailable');return c;}
 function detached(job){const c=context(job.sessionId);return c.sourceRevision!==job.binding.sourceRevision||(c.goal&&c.goal!==jobGoal(job))||(job.kind==='generate'?c.planRunId!==job.planRunId||!c.plan||hash(c.plan)!==job.planDigest:c.planRunId!==(job.runId||job.basePlanRunId)||(job.runId&&(!c.plan||hash(c.plan)!==job.planDigest)));}
 function view(job){const out=clone(job);delete out.input;delete out.remotePlan;delete out.basePlanRunId;out.detached=detached(job);out.reviseEligible=false;if(job.fixtureId==='reading_queue_pdf_v1'&&job.kind==='plan'&&job.status==='succeeded'&&job.runId&&!out.detached&&!blocked()){try{assertIdle(job.sessionId);const row=db.prepare('SELECT * FROM remote_provider_plans WHERE run_id=? AND owner=? AND session_id=?').get(job.runId,owner,job.sessionId),saved=row?JSON.parse(row.payload):null;out.reviseEligible=!!(row&&row.plan_request_id===job.requestId&&row.remote_plan_digest===job.remotePlanDigest&&row.local_plan_digest===job.planDigest&&saved.fixtureId===job.fixtureId&&saved.inputDigest===job.inputDigest&&hash(saved.graph)===row.remote_plan_digest&&saved.sourceRevisionAtDispatch===job.binding.sourceRevision&&!db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(job.runId,job.sessionId));}catch{out.reviseEligible=false;}}out.repairEligible=job.fixtureId==='habit_tracker_source_v1'&&job.kind==='generate'&&job.status==='failed'&&job.failureStage==='source_validation'&&job.failureCode==='source_schema_rejected'&&!job.result&&job.resumeEligible!==true&&job.attemptedCalls===(job.taskCount||3)+1&&job.receivedResponses===(job.taskCount||3)+1&&!out.detached&&!!db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(job.planRunId,job.sessionId);out.requestSourceRevision=job.binding.sourceRevision;out.execution='not_run';out.tests='not_run';out.billing='Remote charges are not included in local budget totals; no free-credit or dollar-cap guarantee.';return out;}
 function checkedUsage(r,max){
  if(!Number.isInteger(r.attemptedCalls)||r.attemptedCalls<0||r.attemptedCalls>max||!Number.isInteger(r.receivedResponses)||r.receivedResponses<0||r.receivedResponses>r.attemptedCalls||typeof r.usageComplete!=='boolean')fail('remote_receipt_counts_invalid');
  exact(r.usage,['prompt_tokens','completion_tokens','total_tokens']);for(const n of Object.values(r.usage))if(!Number.isSafeInteger(n)||n<0||n>1e9)fail('remote_receipt_usage_invalid');
  const all=['prompt_tokens','completion_tokens','total_tokens'].every(k=>Object.hasOwn(r.usage,k));if(r.usageComplete&&(!all||r.attemptedCalls!==r.receivedResponses||r.attemptedCalls===0))fail('remote_receipt_usage_invalid');
  if(all&&r.usage.total_tokens!==r.usage.prompt_tokens+r.usage.completion_tokens)fail('remote_receipt_usage_invalid');
 }
 function planCanonical(graph,job){validateStructure(graph);if(graph.goal!==jobGoal(job)||(!job.fixtureId&&graph.tasks.length!==3)||(job.fixtureId&&(graph.tasks.length<1||graph.tasks.length>6))||graph.runs?.length||graph.events?.length)fail('remote_plan_scope_invalid');const tasks=validatePlan({tasks:graph.tasks.map(t=>({id:t.id,title:t.title,instruction:t.instructions,dependencies:t.deps,role:'implementation',outputKind:'artifact'}))});const architecture=validateStructuredArchitecture(graph.architecture);return {goal:jobGoal(job),tasks,architecture,alternatives:[],clarificationQuestions:[],sourceRevision:null,needsDesignDraft:false};}
 function adoptPlan(job,receipt){
  const graph=receipt.result?.plan;if(!graph||hash(graph)!==receipt.planDigest)fail('remote_plan_digest_mismatch');
  const plan=planCanonical(graph,job),digest=hash(plan);job.remotePlan=clone(graph);job.remotePlanDigest=receipt.planDigest;job.planDigest=digest;
  if(detached(job)){job.detached=true;return;}
  const existing=db.prepare('SELECT run_id,payload FROM remote_provider_plans WHERE owner=? AND session_id=? AND plan_request_id=?').get(owner,job.sessionId,job.requestId);
  if(existing){const saved=JSON.parse(existing.payload);job.runId=existing.run_id;job.events=saved.events;return;}
  const runId='run_'+randomUUID(),time=new Date(now()).toISOString();
  const provenance={...(job.fixtureId?{fixtureId:job.fixtureId,inputDigest:job.inputDigest}:{}),requestId:job.requestId,remoteJobId:receipt.jobId,remotePlanDigest:receipt.planDigest,localPlanDigest:digest,sourceRevisionAtDispatch:job.binding.sourceRevision,origin:'fresh_remote_plan_response',localExecution:'not_run',remoteBillingNotInLocalTotals:true};
  const events=[{type:'remote.plan.received',...provenance,usage:receipt.usage,usageComplete:receipt.usageComplete,attemptedCalls:receipt.attemptedCalls,receivedResponses:receipt.receivedResponses},
   {type:'plan.created',...plan,...(job.revisionOf?{revisionOf:{basePlanRunId:job.parentPlanRunId,remotePlanRequestId:job.revisionOf.requestId,feedbackId:job.revisionOf.feedbackId}}:{}),interactionMode:'plan',remoteStudy:provenance,summary:'Fresh bounded remote plan received from Muse Spark; review and approval required before generation.'},
   {type:'run.completed',meaning:'plan_ready_for_approval',execution:'not_run',tests:'not_run',verified:false}].map((e,i)=>({...e,id:runId+':'+(i+1),runId,sequence:i+1,time}));
  db.exec('BEGIN IMMEDIATE');try{if(detached(job))fail('remote_plan_context_changed');db.prepare("INSERT INTO runs(id,operation,session_id,owner,model,status,reserved,charged,started_calls,usage_known,reason,created,finished) VALUES(?,?,?,?,?,'completed',0,0,0,?,'fresh_remote_plan_receipt',?,?)").run(runId,'remote_plan_'+job.requestId,job.sessionId,owner,job.fixtureId?'Muse Spark imported-input planner':'Remote Study planner',receipt.usageComplete?1:0,time,time);
   for(const e of events)db.prepare('INSERT INTO events VALUES(?,?,?)').run(runId,e.sequence,JSON.stringify(e));
   db.prepare('INSERT INTO remote_provider_plans VALUES(?,?,?,?,?,?,?)').run(runId,owner,job.sessionId,job.requestId,receipt.planDigest,digest,JSON.stringify({plan,graph,events,sourceRevisionAtDispatch:job.binding.sourceRevision,...(job.fixtureId?{fixtureId:job.fixtureId,inputDigest:job.inputDigest,inputSummary:job.inputSummary}: {})}));
   db.prepare('DELETE FROM plan_approvals WHERE session_id=?').run(job.sessionId);db.prepare('DELETE FROM plan_choices WHERE session_id=?').run(job.sessionId);job.runId=runId;job.events=events;job.goal=plan.goal;job.tasks=plan.tasks;job.architecture=plan.architecture;job.sourceRevision=plan.sourceRevision;write(job);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}job.runId=runId;job.events=events;job.goal=plan.goal;job.tasks=plan.tasks;job.architecture=plan.architecture;job.sourceRevision=plan.sourceRevision;
 }
 function checkpointSummary(job,r){
  if(!job.fixtureId||job.kind!=='generate'||r.status!=='failed'||!Array.isArray(r.checkpoints)||r.checkpoints.length!==job.taskIds?.length)return null;
  try{
   const row=db.prepare('SELECT payload FROM remote_provider_plans WHERE run_id=? AND owner=? AND session_id=?').get(job.planRunId,owner,job.sessionId);if(!row)return null;
   const plan=JSON.parse(row.payload).plan,pending=new Map(plan.tasks.map(t=>[t.id,t])),done=new Set(),summary=[];
   for(const c of r.checkpoints){exact(c,['taskId','artifacts','digest']);const task=[...pending.values()].find(t=>t.dependencies.every(d=>done.has(d)));if(!task||c.taskId!==task.id||!DIGEST.test(c.digest||''))return null;
    const artifacts=validateArtifacts({artifacts:c.artifacts});if(artifacts.reduce((n,a)=>n+Buffer.byteLength(a.content),0)>8000)return null;
    if(hash({fixtureId:job.fixtureId,inputDigest:job.inputDigest,planDigest:job.remotePlanDigest,taskId:c.taskId,artifacts})!==c.digest)return null;
    summary.push({taskId:c.taskId,digest:c.digest,artifactCount:artifacts.length});pending.delete(task.id);done.add(task.id);
   }return summary;
  }catch{return null;}
 }
 function accept(job,r){
  if(!r||Buffer.byteLength(JSON.stringify(r))>(job.fixtureId?400000:250000)||r.requestId!==job.requestId||r.kind!==job.kind||!UUID.test(r.jobId||'')||!['running','succeeded','failed','outcome_unknown'].includes(r.status)||hash(r.binding)!==hash(job.binding))fail('remote_receipt_binding_mismatch');
  if(job.jobId&&job.jobId!==r.jobId)fail('remote_job_changed');
  if(job.fixtureId&&(r.fixtureId!==job.fixtureId||r.inputDigest!==job.inputDigest))fail('remote_fixture_receipt_mismatch');
  if(job.revisionOf&&(r.expectedCalls!==1||hash(r.revisionOf)!==hash(job.revisionOf)))fail('remote_revision_receipt_mismatch');
  if(!job.revisionOf&&r.revisionOf!==undefined)fail('remote_revision_receipt_mismatch');
  if(job.resumeOf&&(r.resumeOf!==job.resumeOf||r.expectedCalls!==1))fail('remote_resume_receipt_mismatch');
  if(job.repairOf&&(r.repairOf!==job.repairOf||r.expectedCalls!==1))fail('remote_repair_receipt_mismatch');
  if(!job.repairOf&&r.repairOf!==undefined)fail('remote_repair_receipt_mismatch');
  if(!job.resumeOf&&r.resumeOf!==undefined)fail('remote_resume_receipt_mismatch');
  checkedUsage(r,maxCalls(job));
  if(r.attemptedCalls<job.attemptedCalls||r.receivedResponses<job.receivedResponses)fail('remote_counts_regressed');
  if(job.kind==='generate'&&(r.planRequestId!==job.planRequestId||r.planDigest!==job.remotePlanDigest||hash(r.approvalBinding)!==hash(job.approvalBinding)))fail('remote_approval_receipt_mismatch');
  job.jobId=r.jobId;job.status=r.status;job.attemptedCalls=r.attemptedCalls;job.receivedResponses=r.receivedResponses;job.usage=clone(r.usage);job.usageComplete=r.usageComplete;
  job.stage=['plan','draft_1','draft_2','draft_3','draft_4','draft_5','draft_6','draft:t4','draft:t5','draft:t6','draft:t1','draft:t2','draft:t3','assembly','none'].includes(r.stage)?r.stage:null;job.failureStage=['provider_request','provider_headers','provider_body','plan_validation','draft_validation','source_validation','progress_storage','result_storage'].includes(r.failureStage)?r.failureStage:null;job.attemptedCallsMeaning='dispatch_intents_not_confirmed_provider_receipt';const codes=['output_truncated','output_json_invalid','plan_schema_rejected','plan_scope_rejected','draft_schema_rejected','source_schema_rejected','source_scope_rejected','provider_auth_rejected','provider_http_rejected','provider_redirect_blocked','provider_response_too_large','provider_body_invalid','operator_expired_no_further_dispatch'];job.failureCode=r.status==='failed'?(codes.includes(r.failureCode)?r.failureCode:'remote_job_failed'):r.status==='outcome_unknown'?'remote_outcome_unknown':null;
  delete job.schemaDiagnostic;delete job.parseDiagnostic;delete job.sourceDiagnostic;delete job.projectField;
  if(job.fixtureId&&r.status==='failed'){
   const sourceDiagnostic=safeSourceDiagnostic(r.sourceDiagnostic);if(sourceDiagnostic)job.sourceDiagnostic=sourceDiagnostic;const projectField=safeProjectField(r.projectField);if(projectField)job.projectField=projectField;
   const checkpoints=checkpointSummary(job,r);job.resumeEligible=!!checkpoints;job.checkpointSummary=checkpoints||[];
   const diagnostic=safeFixtureDiagnostic(r.schemaDiagnostic);if(diagnostic)job.schemaDiagnostic=diagnostic;
   const parse=r.parseDiagnostic;if(parse&&['model_response_empty','model_response_fenced_invalid','model_response_unsafe_wrapper','model_response_invalid_json'].includes(parse.field)&&Number.isSafeInteger(parse.contentBytes)&&parse.contentBytes>=0&&parse.contentBytes<=160000)job.parseDiagnostic={field:parse.field,contentBytes:parse.contentBytes};
  }
  job.everOutcomeUnknown=job.everOutcomeUnknown||r.status==='outcome_unknown';
  if(r.status==='succeeded'){
   const max=maxCalls(job);if(r.attemptedCalls!==max||r.receivedResponses!==max)fail('remote_success_counts_invalid');
   if(job.kind==='plan')adoptPlan(job,r);
   else{if(job.repairOf&&r.result?.pipeline!=='approved_fixture_direct_assembly_repair')fail('remote_repair_pipeline_mismatch');const source=r.result?.source,manifest=r.result?.manifest;if(!source||!manifest||manifest.source?.runId!==r.jobId||manifest.source?.planRevision!==job.remotePlanDigest||JSON.stringify(manifest.source?.taskIds)!==JSON.stringify(job.taskIds))fail('remote_source_binding_invalid');const checked=validateProject(source,manifest.source);if(JSON.stringify(checked.manifest)!==JSON.stringify(manifest))fail('remote_source_manifest_invalid');job.result={...(job.repairOf?{repairOf:job.repairOf,pipeline:job.pipeline,expectedCalls:1}:{}),source:clone(source),manifest:clone(manifest),origin:'fresh_remote_generation',localPlanRunId:job.planRunId,localPlanDigest:job.planDigest,remotePlanDigest:job.remotePlanDigest,execution:'not_run',tests:'not_run'};}
  }
  write(job);return view(job);
 }
 async function observe(job,request){try{const response=await transport(request);if(!response||!Number.isInteger(response.status)||response.status<200||response.status>599||!response.body)fail('remote_transport_response_invalid');const r=response.body;const latest=read(job.sessionId,job.requestId);if((request.method==='GET'||request.path==='/api/operator/close-request')&&response.status===200&&r.requestId===job.requestId&&r.status==='not_dispatched'&&r.barrier==='closed_no_dispatch'&&UUID.test(r.jobId||'')&&(!latest.jobId||latest.jobId===r.jobId)&&r.attemptedCalls===0&&r.receivedResponses===0&&!immutableStates.has(latest.status)){
 if(latest.attemptedCalls!==0||latest.receivedResponses!==0)fail('remote_close_conflicting_evidence');latest.status='cancelled_not_dispatched';latest.jobId=r.jobId;latest.barrier='closed_no_dispatch';latest.observation='remote_atomic_no_dispatch_barrier';latest.failureCode=null;latest.remoteDispatchPrevented=true;write(latest);return view(latest);
 }if(request.method==='GET'&&response.status===404&&r.requestId===job.requestId&&r.status==='not_found'&&!immutableStates.has(latest.status)){latest.status='outcome_unknown';latest.everOutcomeUnknown=true;latest.observation='remote_record_not_found_at_observation';latest.failureCode='remote_outcome_unknown';write(latest);return view(latest);}if(immutableStates.has(latest.status))return view(latest);return accept(latest,r);}catch{const saved=read(job.sessionId,job.requestId);if(immutableStates.has(saved.status))return view(saved);saved.status='outcome_unknown';saved.everOutcomeUnknown=true;saved.failureCode='remote_transport_or_receipt_unconfirmed';write(saved);return view(saved);}}
 function claim(kind,input,{resume=false,repair=false,revise=false}={}){
  exact(input,kind==='plan'?(revise?['sessionId','requestId','sourceRevision','consent','planRunId','feedbackId']:['sessionId','requestId','sourceRevision','consent','fixtureId','inputEvidence']):['sessionId','requestId','planRunId','sourceRevision','consent',...(resume||repair?['sourceRequestId']:[])]);owned(input.sessionId);
  if(!UUID.test(input.requestId||'')||input.consent!==true||!revision(input.sourceRevision))fail('remote_input_invalid');
  const parentRow=revise?db.prepare('SELECT * FROM remote_provider_plans WHERE run_id=? AND session_id=? AND owner=?').get(input.planRunId,input.sessionId,owner):null;
  const parent=parentRow?JSON.parse(parentRow.payload):null;
  if(revise&&(!parentRow||parent.fixtureId!=='reading_queue_pdf_v1'||input.feedbackId!=='reading_queue_state_flow_v1'))fail('remote_revision_unavailable');
  const selectedFixture=revise?fixtureFor(parent.fixtureId):kind==='plan'&&input.fixtureId!==undefined?fixtureFor(input.fixtureId):null;
  if(revise&&!selectedFixture)fail('remote_revision_unavailable');
  if(kind==='plan'&&((input.fixtureId!==undefined&&!selectedFixture)||(!selectedFixture&&input.inputEvidence!==undefined)))fail('remote_fixture_input_mismatch');
  const verified=revise?{fixtureId:parent.fixtureId,inputDigest:parent.inputDigest,summary:parent.inputSummary}:selectedFixture?verifyRemoteFixtureInput(selectedFixture,input.inputEvidence,currentSource(input.sessionId)):null;
  const normalizedInput=revise?input:verified?{sessionId:input.sessionId,requestId:input.requestId,sourceRevision:input.sourceRevision,consent:true,fixtureId:verified.fixtureId,inputDigest:verified.inputDigest}:input;
  const prior=db.prepare('SELECT owner,session_id,payload FROM remote_provider_jobs WHERE request_id=?').get(input.requestId);
  if(prior){if(prior.owner!==owner||prior.session_id!==input.sessionId)fail('remote_request_unavailable');const j=JSON.parse(prior.payload);if(j.kind!==kind||hash(j.input)!==hash(normalizedInput))fail('remote_request_reuse_mismatch');return {job:j,duplicate:true};}
  if(!readiness().connected)fail('remote_provider_disconnected');if(blocked())fail('remote_job_pending');assertIdle(input.sessionId);
  const c=context(input.sessionId);const requestedGoal=selectedFixture?.goal||REMOTE_STUDY_GOAL;if(kind==='plan'&&c.goal&&c.goal!==requestedGoal)fail('remote_new_study_session_required');if(c.sourceRevision!==input.sourceRevision)fail('remote_context_mismatch');
  if(revise&&(c.planRunId!==parentRow.run_id||!c.plan||hash(c.plan)!==parentRow.local_plan_digest||hash(parent.graph)!==parentRow.remote_plan_digest||parent.sourceRevisionAtDispatch!==input.sourceRevision||parent.inputDigest!==selectedFixture.inputDigest||db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(parentRow.run_id,input.sessionId)))fail('remote_revision_requires_current_unapproved_plan');
  const job={requestId:input.requestId,sessionId:input.sessionId,kind,status:'dispatching',input:clone(normalizedInput),...(verified?{fixtureId:verified.fixtureId,inputDigest:verified.inputDigest,inputSummary:verified.summary}:{}),binding:{sessionId:input.sessionId,goalDigest:selectedFixture?createHash('sha256').update(requestedGoal).digest('hex'):goalDigest,sourceRevision:input.sourceRevision},basePlanRunId:c.planRunId||null,jobId:null,stopRequested:false,attemptedCalls:0,receivedResponses:0,usage:{},usageComplete:false,everOutcomeUnknown:false,createdAt:now(),updatedAt:now()};
  if(revise)Object.assign(job,{parentPlanRunId:parentRow.run_id,revisionOf:{requestId:parentRow.plan_request_id,planDigest:parentRow.remote_plan_digest,feedbackId:input.feedbackId},expectedCalls:1});
  if(kind==='generate'){
   const row=db.prepare('SELECT * FROM remote_provider_plans WHERE run_id=? AND session_id=? AND owner=?').get(input.planRunId,input.sessionId,owner);
   if(!row||c.planRunId!==row.run_id||!db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(row.run_id,input.sessionId))fail('remote_approved_plan_required');
   const saved=JSON.parse(row.payload);job.taskIds=saved.plan.tasks.map(t=>t.id);if(saved.fixtureId){const f=fixtureFor(saved.fixtureId);if(!f||f.inputDigest!==saved.inputDigest)fail('remote_fixture_input_mismatch');Object.assign(job,{fixtureId:saved.fixtureId,inputDigest:saved.inputDigest,inputSummary:saved.inputSummary,taskCount:saved.plan.tasks.length});job.binding.goalDigest=createHash('sha256').update(f.goal).digest('hex');}if(c.goal!==jobGoal(job))fail('remote_context_mismatch');if(hash(saved.plan)!==row.local_plan_digest||saved.sourceRevisionAtDispatch!==input.sourceRevision||!c.plan||hash(c.plan)!==row.local_plan_digest)fail('remote_local_plan_changed');
   Object.assign(job,{planRunId:row.run_id,planRequestId:row.plan_request_id,remotePlanDigest:row.remote_plan_digest,planDigest:row.local_plan_digest,approvalBinding:{sessionId:input.sessionId,goalDigest:job.binding.goalDigest,sourceRevision:input.sourceRevision,localPlanRunId:row.run_id,localPlanDigest:row.local_plan_digest}});
   if(repair){const previous=read(input.sessionId,input.sourceRequestId);if(job.fixtureId!=='habit_tracker_source_v1'||previous.requestId===input.requestId||previous.kind!=='generate'||previous.status!=='failed'||previous.failureStage!=='source_validation'||previous.failureCode!=='source_schema_rejected'||previous.result||previous.resumeEligible===true||previous.attemptedCalls!==(previous.taskCount||3)+1||previous.receivedResponses!==(previous.taskCount||3)+1||detached(previous)||previous.planRunId!==job.planRunId||previous.remotePlanDigest!==job.remotePlanDigest||previous.fixtureId!==job.fixtureId||previous.inputDigest!==job.inputDigest||hash(previous.approvalBinding)!==hash(job.approvalBinding))fail('remote_repair_unavailable');job.repairOf=previous.requestId;job.expectedCalls=1;job.pipeline='approved_fixture_direct_assembly_repair';}
   if(resume){const previous=read(input.sessionId,input.sourceRequestId);if(!job.fixtureId||previous.requestId===input.requestId||previous.kind!=='generate'||previous.status!=='failed'||previous.resumeEligible!==true||!Array.isArray(previous.checkpointSummary)||previous.checkpointSummary.length!==job.taskIds.length||detached(previous)||previous.planRunId!==job.planRunId||previous.remotePlanDigest!==job.remotePlanDigest||previous.fixtureId!==job.fixtureId||previous.inputDigest!==job.inputDigest||hash(previous.approvalBinding)!==hash(job.approvalBinding))fail('remote_resume_unavailable');job.resumeOf=previous.requestId;job.expectedCalls=1;}

  }
  db.prepare('INSERT INTO remote_provider_jobs VALUES(?,?,?,?,?,?,?,?)').run(job.requestId,owner,job.sessionId,kind,job.status,JSON.stringify(job),job.createdAt,job.updatedAt);return {job,duplicate:false};
 }
 function sourceEvidence({sessionId,requestId,source}){
  const job=read(sessionId,requestId);
  if(job.kind!=='generate'||job.status!=='succeeded'||!job.result||detached(job)||hash(source)!==hash(job.result.source))fail('remote_source_not_current');
  if(!db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(job.planRunId,sessionId))fail('remote_approved_plan_required');
  return {format:'mulo-live-remote-source-evidence',version:1,...(job.repairOf?{repairOf:job.repairOf,pipeline:job.pipeline,expectedCalls:1}:{}),...(job.fixtureId?{fixtureId:job.fixtureId,inputDigest:job.inputDigest}:{}),requestId,remoteJobId:job.jobId,
   localPlanRunId:job.planRunId,localPlanDigest:job.planDigest,remotePlanDigest:job.remotePlanDigest,
   planRequestId:job.planRequestId,originalSourceDigest:hash(source),sourceRevisionAtDispatch:job.binding.sourceRevision,
   providerProvenance:'authenticated_gateway_response_not_local_execution',execution:'not_run',tests:'not_run'};
 }
 return {
  sourceEvidence,
  assertSourceEvidence(e,sessionId){const job=read(sessionId,e.requestId);const fresh=sourceEvidence({sessionId,requestId:e.requestId,source:job.result?.source});if(hash(e)!==hash(fresh))fail('remote_source_evidence_changed');return true;},
  sourceForReview({sessionId,requestId}){const job=read(sessionId,requestId);const source=job.result?.source;sourceEvidence({sessionId,requestId,source});return clone(source);},
  blocks:blocked,
  status({sessionId}){owned(sessionId);const row=db.prepare('SELECT payload FROM remote_provider_jobs WHERE owner=? AND session_id=? ORDER BY created DESC,rowid DESC LIMIT 1').get(owner,sessionId);return {...readiness(),workflow:'study_planner_v1',fixedGoal:REMOTE_STUDY_GOAL,fixtures:fixtures.map(publicRemoteFixture),job:row?view(JSON.parse(row.payload)):null};},
  async plan(input){const {job,duplicate}=claim('plan',input);if(duplicate)return {...view(job),duplicate:true};return observe(job,{method:'POST',path:job.fixtureId?'/api/operator/fixture-plan':'/api/operator/plan',body:{requestId:job.requestId,consent:true,binding:job.binding,...(job.fixtureId?{fixtureId:job.fixtureId,inputDigest:job.inputDigest}: {})}});},
  async revise(input){const {job,duplicate}=claim('plan',input,{revise:true});if(duplicate)return {...view(job),duplicate:true};return observe(job,{method:'POST',path:'/api/operator/fixture-revise',body:{requestId:job.requestId,consent:true,binding:job.binding,fixtureId:job.fixtureId,inputDigest:job.inputDigest,parentPlanRequestId:job.revisionOf.requestId,parentPlanDigest:job.revisionOf.planDigest,feedbackId:job.revisionOf.feedbackId}});},
  async generate(input){const {job,duplicate}=claim('generate',input);if(duplicate)return {...view(job),duplicate:true};return observe(job,{method:'POST',path:job.fixtureId?'/api/operator/fixture-generate':'/api/operator/generate',body:{requestId:job.requestId,consent:true,planRequestId:job.planRequestId,planDigest:job.remotePlanDigest,approvalBinding:job.approvalBinding,...(job.fixtureId?{fixtureId:job.fixtureId,inputDigest:job.inputDigest}: {})}});},
  async resume(input){const {job,duplicate}=claim('generate',input,{resume:true});if(duplicate)return {...view(job),duplicate:true};return observe(job,{method:'POST',path:'/api/operator/fixture-resume',body:{requestId:job.requestId,consent:true,planRequestId:job.planRequestId,planDigest:job.remotePlanDigest,approvalBinding:job.approvalBinding,fixtureId:job.fixtureId,inputDigest:job.inputDigest,sourceRequestId:job.resumeOf}});},
  async repair(input){const {job,duplicate}=claim('generate',input,{repair:true});if(duplicate)return {...view(job),duplicate:true};return observe(job,{method:'POST',path:'/api/operator/fixture-repair',body:{requestId:job.requestId,consent:true,planRequestId:job.planRequestId,planDigest:job.remotePlanDigest,approvalBinding:job.approvalBinding,fixtureId:job.fixtureId,inputDigest:job.inputDigest,sourceRequestId:job.repairOf}});},
  async closeRequest(input){exact(input,['sessionId','requestId','consent']);if(input.consent!==true)fail('remote_input_invalid');const job=read(input.sessionId,input.requestId);if(immutableStates.has(job.status))return view(job);if(!readiness().connected)fail('remote_provider_disconnected');return observe(job,{method:'POST',path:'/api/operator/close-request',body:{requestId:job.requestId,consent:true}});},
  async request({sessionId,requestId}){const job=read(sessionId,requestId);if(immutableStates.has(job.status)||!readiness().connected)return view(job);return observe(job,{method:'GET',path:'/api/operator/request?requestId='+encodeURIComponent(requestId)});},
  stop({sessionId,requestId}){const job=read(sessionId,requestId);job.stopRequested=true;write(job);return {...view(job),remoteCancellationConfirmed:false};}
 };
}
