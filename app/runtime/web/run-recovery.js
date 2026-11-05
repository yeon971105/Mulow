import {safeAgentIterationRequestFields} from './agent-iteration.js';
import {safeModelOutputProgress} from './model-output-progress.js';
import {runtimeRouteEventFields,RUNTIME_ROUTE_TYPES} from './runtime-routes.js';
import {safeAdaptiveWorkFields} from './adaptive-work.js';
import {planDocumentEventFields,DOCUMENT_EVENT_TYPES} from './plan-document-events.js';
import {documentPlanFields,documentDesignLineageFields} from './plan-document.js';
import {planSourceEventFields} from './plan-source-events.js';
import {storedPlanArtifactFields} from './planning-artifact.js';
import {continuationRequestFields,terminalContinuationFields,providerIdentityFields} from './terminal-continuation.js';
import {declarativeBuildFields} from './declarative-build-events.js';
import {implementationProfileFields} from './implementation-profile.js';
import {planningReadinessEvidenceFields} from './planning-readiness.js';
import {validatePackageOptionsOrigin,safePackageOptionsWarning} from './package-decision-options.js';
import {clarificationChoiceFields} from './clarification-choices.js';
import {requiredCapabilityFields} from './goal-capabilities.js';
import {createPackageRecoveryGuard,safePackageAdmission,safePackageSourceBase,safeRefinementHandoff} from './package-source-evidence.js';
import {safeSourceVerification} from './source-verification-receipt.js';
import {safeRunControlEvent} from './run-control.js';
import {taskComponentFields,validateTaskComponentBindings} from './task-components.js';
import {safePlanDiagnostic} from './plan-diagnostics.js';
import {validateWorkerBranches,MAX_WORKER_BRANCH_PROPOSALS} from './worker-branches.js';
import {validateRequestEvidence} from './request-evidence.js';
import {safeTransportDetails} from './provider-transport.js';
import {safeProjectField} from './project-diagnostics.js';
import {MAX_WORKFLOW_TASKS,MAX_WORKFLOW_DEPENDENCIES,isWorkflowTaskId,validateWorkflowPhases,PHASE_FAILURE_REASONS} from './workflow-limits.js';
import {WORK_PHASES,safeJournalPath} from './work-journal.js';
import {ensurePlanConversationMessage} from './import-analysis.js';
import {recoveredSession} from './model.js';
import {applyLiveEvent,safeProgressText,safePlanBranchFields,safeRemoteStudyFields} from './live.js';
import {validateStructuredArchitecture} from './architecture-schema.js';
import {validateEventLineage} from './event-lineage.js';
import {planningSources} from './planning-intake.js';
import {validateTaskExpansion,validateExpansionDiagnostic,MAX_EXPANSIONS_PER_RUN} from './task-expansion.js';

export const RUN_RECOVERY_LIMIT=50;
// 48 validated 16 KB drafts may expand when JSON escapes control characters.
// Recovery remains bounded and reports failures rather than dropping events.
const MAX_HISTORY_BYTES=6_000_000,MAX_RECOVERY_BYTES=12_000_000,MAX_EVENTS=4000;
const RUN_ID=/^run_[A-Za-z0-9-]{1,100}$/;
const SESSION_ID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const STATUSES=new Set(['running','completed','failed','cancelled']);
const EVENT_TYPES=new Set(['model.output.progress',...DOCUMENT_EVENT_TYPES,'plan.source.requested','plan.source.supplied','continuation.seeded','package.options_warning','package.options','package.progress','run.pause_requested','run.paused','run.resumed','plan.branches_proposed','plan.branches_rejected','goal.summarized','work.progress','project_recovery.created','project_recovery.completed','continuation.created','continuation.completed','recovery.created','recovery.completed','plan.proposed','expansion.proposed','expansion.rejected','project.generating','project.generated','run.started','run.completed','run.failed','run.cancelled','agent.started','agent.completed','plan.created','plan.alternatives_rejected','architecture.draft_rejected','task.started','task.completed','task.failed','tool.started','tool.completed','tool.failed','model.response','context.prepared','checkpoint.created','artifacts.created','architecture.created','validation.completed','message.answer','accounting.unknown','steering.requested','steering.waiting','steering.ready','steering.running']);
const activeRecoveries=new WeakMap();
// A recovered conversation has no browser-side binding. Rebind it only when the
// latest saved proposal is the same completed, server-observed conversation and
// neither the old plan nor the restored session relies on lost/changed inputs.
// The server still checks the proposal, plan head, session and source revision.
export function bindRecoveredProposal(s,p,revision){
 const live=s?.liveRun,last=s?.runs?.at(-1),base=s?.pendingPlan;
 const provider=last?.model==='meta-models/muse-spark-open-1026'?'spark':last?.model==='nvidia/Nemotron-3_5-Lightning'?'nebius':null;
 if(!s?.recovery?.historyOnly||s.recovery.partial||s.planProposal!==p||!base||base.stale||p.basePlanRunId!==base.runId||p.sourceRevision||base.sourceRevision||p.localInputRevision!=null||p.localModel!=null)return false;
 if(!live?.recovered||!live.serverObserved||live.active||live.status!=='completed'||live.runId!==p.runId||!live.conversation||last?.id!==p.runId||!last.serverObserved||last.status!=='completed'||!provider||provider!==s.model)return false;
 if(s.planningIntake?.revision!==1||revision!==s.id+':inputs:1'||(s.references||[]).length||(s.chatAttachmentRevision||0)!==0||planningSources(s).length)return false;
 if(!(s.events||[]).some(e=>e.runId===p.runId&&e.type==='plan.proposed'&&e.serverObserved))return false;
 p.localInputRevision=revision;p.localModel=s.model;return true;
}
const bytes=value=>new TextEncoder().encode(value).length;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const validPath=value=>typeof value==='string'&&/^[-A-Za-z0-9_./]{1,180}$/.test(value)&&!value.startsWith('/')&&!value.split('/').some(p=>!p||p==='.'||p==='..')&&!/(^|\/)(\.env|credentials|secrets)(\.|\/|$)/i.test(value);
function text(value,max=4000){
 if(typeof value!=='string'||value.length>max)throw Error('Invalid saved text.');
 return safeProgressText(value,max)
  .replace(/\b(?:AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,'[REDACTED]')
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]')
  .replace(/("(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|authorization|csrf|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,'$1"[REDACTED]"')
  .replace(/\b(csrf|cookie|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1=[REDACTED]');
}
function timestamp(value){if(typeof value!=='string'||value.length>80||!Number.isFinite(Date.parse(value)))throw Error('Invalid saved timestamp.');return value;}
function money(value){if(!Number.isFinite(value)||value<0||value>100)throw Error('Invalid saved accounting.');return value;}
function binding(value){if(!object(value)||!RUN_ID.test(value.id)||!SESSION_ID.test(value.sessionId)||!STATUSES.has(value.status))throw Error('Invalid saved run binding.');return {id:value.id,sessionId:value.sessionId,status:value.status};}
function cleanArchitecture(value){
 const graph=validateStructuredArchitecture(value);
 return {...graph,nodes:graph.nodes.map(n=>({...n,label:text(n.label,160),type:text(n.type,40),description:text(n.description,2000),responsibilities:n.responsibilities.map(v=>text(v,300)),interfaces:n.interfaces.map(v=>text(v,300)),dataOwnership:n.dataOwnership.map(v=>text(v,300)),boundary:text(n.boundary,160)}))};
}
function planTasks(value){
 if(!Array.isArray(value)||!value.length||value.length>MAX_WORKFLOW_TASKS)throw Error('Invalid saved plan.');
 const ids=new Set(value.map(t=>t?.id));if(ids.size!==value.length)throw Error('Invalid saved task IDs.');
 const tasks=value.map(t=>{
  if(!object(t)||!isWorkflowTaskId(t.id)||!Array.isArray(t.dependencies)||t.dependencies.length>MAX_WORKFLOW_DEPENDENCIES||new Set(t.dependencies).size!==t.dependencies.length||t.dependencies.some(id=>id===t.id||!ids.has(id)))throw Error('Invalid saved dependencies.');
  if(!['implementation','research','review'].includes(t.role)||!['artifact','architecture'].includes(t.outputKind||'artifact'))throw Error('Invalid saved task.');
  const title=text(t.title,100),instruction=text(t.instruction,2000);if(!title.trim()||!instruction.trim())throw Error('Invalid saved task text.');
  return {id:t.id,title,instruction,dependencies:[...t.dependencies],role:t.role,outputKind:t.outputKind||'artifact',...taskComponentFields(t),...(t.phaseId!==undefined?{phaseId:t.phaseId}:{}),...(t.phaseTitle!==undefined?{phaseTitle:t.phaseTitle}:{})};
 });
 try{validateWorkflowPhases(tasks);}catch{throw Error('Invalid saved phases.');}
 const done=new Set();for(let i=0;i<tasks.length;i++)for(const t of tasks)if(t.dependencies.every(id=>done.has(id)))done.add(t.id);if(done.size!==tasks.length)throw Error('Invalid saved dependency cycle.');return tasks;
}
function checkpoint(value){
 if(!object(value)||!validPath(value.path))throw Error('Invalid saved checkpoint.');
 const version=v=>{if(!object(v)||!SESSION_ID.test(v.id)||!Array.isArray(v.files)||v.files.length>300||v.files.some(p=>!validPath(p)))throw Error('Invalid saved checkpoint version.');return {id:v.id,label:text(v.label,250),time:timestamp(v.time),files:[...v.files]};};
 return {path:value.path,before:version(value.before),after:version(value.after)};
}
/** Strict, allowlisted snapshot. Never retain status CSRF, headers, prompts or approval fields. */
function savedGoalMetadata(value){const result={};for(const [key,max]of [['goalTitle',80],['goalSummary',240]]){if(value?.[key]===undefined)continue;const v=value[key];if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('Invalid saved goal metadata');result[key]=v.trim();}return result;}
function savedRevision(value){if(!object(value)||!RUN_ID.test(value.basePlanRunId)||!RUN_ID.test(value.proposalRunId))throw Error('Invalid saved goal revision');return {basePlanRunId:value.basePlanRunId,proposalRunId:value.proposalRunId};}
function savedPlanRestore(value){if(!object(value)||!RUN_ID.test(value.sourcePlanRunId)||!RUN_ID.test(value.previousPlanRunId))throw Error('Invalid saved plan restore');return {sourcePlanRunId:value.sourcePlanRunId,previousPlanRunId:value.previousPlanRunId};}
function savedGoalUpdate(value){if(!object(value)||typeof value.goal!=='string'||!value.goal.trim()||value.goal.length>6000)throw Error('Invalid saved goal update');const metadata=savedGoalMetadata(value);if(!metadata.goalTitle||!metadata.goalSummary)throw Error('Invalid saved goal update');return {goal:text(value.goal,6000),...metadata};}
export function validateSavedRun(value,expected){
 const b=binding(expected),actual=binding(value);
 if(actual.id!==b.id||actual.sessionId!==b.sessionId||!Array.isArray(value.events)||value.events.length>MAX_EVENTS||bytes(JSON.stringify(value))>MAX_HISTORY_BYTES)throw Error('Invalid saved history.');
 const run={...actual,active:value.active===true,reservedUsd:money(value.reservedUsd),chargedUsd:money(value.chargedUsd),usageKnown:value.usageKnown===true,events:[]};
 let packageGuard=null;
 let projectRecovery=null,projectRecoveryDone=false,projectRevision=null,eventLineage=null;
 let continuation=null,continuationDone=false,planTaskRecords=[],workerEventSeen=false;const dispatchedTasks=new Set(),continuationValidated=new Set(),continuationFailed=new Set();
 let recovery=null,recoveryDone=false;const completedTasks=new Set(),validatedTasks=new Set(),architectureTasks=new Set();
 let summaryRequested=false,automaticSummary=false,summarySeen=false;let tasks=new Set(),started=false,planned=false,terminal=false,projectPlanId=null,projectGenerated=false,projectStrategy=null,projectBaseRevision=undefined,interactionMode=null;const agents=new Set(),artifactTasks=new Set(),invocations=new Set(),finishedInvocations=new Set(),draftStarted=new Set(),draftActive=new Set(),draftValidated=new Set(),draftFailed=new Set(),expansionOrigins=new Set();let expansionCount=0;const branchOrigins=new Set();let branchCount=0;
 for(const [i,e] of value.events.entries()){
  if(!object(e)||e.runId!==b.id||e.sequence!==i+1||e.id!==b.id+':'+e.sequence||!EVENT_TYPES.has(e.type)&&!RUNTIME_ROUTE_TYPES.has(e.type)&&!['work.step.started','work.refined','work.step.completed'].includes(e.type)||i===0&&e.type!=='run.started')throw Error('Invalid saved event sequence.');
  const adaptiveFields={...safeModelOutputProgress(e,run.events),...safeAdaptiveWorkFields(e,run.events),...runtimeRouteEventFields(e,run.events)};const declarative=declarativeBuildFields(e,run.events,b.sessionId,planTaskRecords);continuationRequestFields(e,run.events);
  const event={...safeAgentIterationRequestFields(e),...adaptiveFields,...planDocumentEventFields(e,run.events),...planSourceEventFields(e,run.events,b.sessionId),...declarative,...terminalContinuationFields(e),...providerIdentityFields(e),id:e.id,runId:b.id,sequence:e.sequence,type:e.type,time:timestamp(e.time)};const controlFields=safeRunControlEvent(e);if(controlFields.phase){if(interactionMode!=='agent'||e.lineage&&controlFields.planRunId!==e.lineage.goalRevision)throw Error('Invalid saved run control binding');Object.assign(event,controlFields);}
  if(e.refinementHandoff!==undefined)event.refinementHandoff=safeRefinementHandoff(e);if(e.sourceBaseAdoption!==undefined)event.sourceBaseAdoption=safePackageSourceBase(e);
  if(terminal&&e.type!=='accounting.unknown')throw Error('Saved event follows run completion.');
  if(e.sessionId!=null&&e.sessionId!==b.sessionId)throw Error('Saved session binding mismatch.');if(e.sessionId!=null)event.sessionId=b.sessionId;
  const lineage=validateEventLineage(e,eventLineage);if(lineage){eventLineage=lineage;event.lineage=lineage;}
  if(e.taskId!=null){if(!tasks.has(e.taskId))throw Error('Unknown saved task.');event.taskId=e.taskId;}
  if(e.parentTaskId!=null){if(!tasks.has(e.parentTaskId))throw Error('Unknown saved parent task.');event.parentTaskId=e.parentTaskId;}
  if(e.agentId!=null){const prefix=b.id+':',kind=typeof e.agentId==='string'&&e.agentId.startsWith(prefix)?e.agentId.slice(prefix.length):'';if(!['planner','briefing','project-author'].includes(kind)&&!(kind.startsWith('worker:')&&isWorkflowTaskId(kind.slice(7))))throw Error('Invalid saved agent.');event.agentId=e.agentId;}
  for(const k of ['summary','inputSummary','outputSummary'])if(e[k]!=null)event[k]=text(e[k]);
  for(const k of ['model','code','meaning','finishReason','name'])if(e[k]!=null)event[k]=text(e[k],160);
  for(const k of ['durationMs','promptTokens','outputTokens','outputLimit','outputAccountingBound','reasoningTokens'])if(e[k]!=null){if(!Number.isFinite(e[k])||e[k]<0||e[k]>Number.MAX_SAFE_INTEGER)throw Error('Invalid saved operation metadata.');event[k]=e[k];}
  if(e.type==='context.prepared')for(const key of ['originalBytes','includedBytes','truncatedArtifacts','artifactCount'])if(e[key]!=null){if(!Number.isSafeInteger(e[key])||e[key]<0)throw Error('Invalid saved context metadata.');event[key]=e[key];}
  if(e.requestEvidence!==undefined&&e.type!=='plan.source.requested'){const agentStart=run.events.find(x=>x.type==='run.started'&&x.agentIterationRequest),documentStart=run.events.find(x=>x.type==='run.started'&&x.documentPlan);if(e.type!=='tool.started'||e.name!=='model.chat.completions'||!documentStart&&!agentStart&&!e.lineage?.nodeId)throw Error('Unexpected saved request evidence.');event.requestEvidence=validateRequestEvidence(e.requestEvidence);if(!documentStart&&!agentStart&&(projectBaseRevision===undefined||event.requestEvidence.sourceRevision!==projectBaseRevision||event.requestEvidence.sourceState!==(projectBaseRevision?'verified':'none')))throw Error('Request source binding mismatch.');if(agentStart&&(e.agentId!==b.id+':planner'||event.requestEvidence.sourceState!=='verified'||event.requestEvidence.sourceRevision!==agentStart.agentIterationRequest.sourceRevision))throw Error('Invalid Agent request evidence origin');if(documentStart&&(documentStart.interactionMode!=='plan'||documentStart.conversation!==true||e.agentId!==b.id+':planner'))throw Error('Invalid document request evidence origin.');}
  if(e.invocationId!=null){if(typeof e.invocationId!=='string'||!e.invocationId.startsWith(b.id+':invocation:')||!/^[1-9][0-9]{0,6}$/.test(e.invocationId.slice((b.id+':invocation:').length)))throw Error('Invalid saved invocation.');event.invocationId=e.invocationId;}
  if(e.diagnostic!==undefined){if(e.type!=='expansion.rejected'||e.code!=='invalid_task_expansion')throw Error('Unexpected saved expansion diagnostic.');event.diagnostic=validateExpansionDiagnostic(e.diagnostic);}
  if(e.responseEnvelope!==undefined){if(e.type!=='model.response'||!['json','fenced_json','invalid','unavailable'].includes(e.responseEnvelope))throw Error('Invalid saved response envelope.');event.responseEnvelope=e.responseEnvelope;}
  if(e.details!=null){const transport=safeTransportDetails(e.details);if(transport)event.details=transport;else{if(!object(e.details)||typeof e.details.field!=='string')throw Error('Invalid saved failure details.');event.details={...(safePlanDiagnostic(e.details)||{}),field:text(e.details.field,80),taskIndex:Number.isInteger(e.details.taskIndex)&&e.details.taskIndex>=0&&e.details.taskIndex<MAX_WORKFLOW_TASKS?e.details.taskIndex:null,...(PHASE_FAILURE_REASONS.includes(e.details.reason)?{reason:e.details.reason}:{}),...(e.code==='invalid_project_output'&&safeProjectField(e.details.projectField)?{projectField:safeProjectField(e.details.projectField)}:{})};}}
  for(const k of ['execution','tests'])if(e[k]!=null){if(!['not_run','passed','failed'].includes(e[k]))throw Error('Invalid saved check.');event[k]=e[k];}
  if(e.checks!=null){if(!Array.isArray(e.checks)||e.checks.length>4||e.checks.some(c=>!['artifact_schema','safe_relative_paths','content_byte_limit','architecture_schema'].includes(c)))throw Error('Invalid saved checks.');event.checks=[...e.checks];}
  if(e.type==='run.started'){
   Object.assign(event,safePackageAdmission(e));
   if(started||i!==0)throw Error('Duplicate saved run start.');started=true;event.sessionId=b.sessionId;event.model=text(e.model||'Model not recorded',160);event.budgetReservedUsd=money(e.budgetReservedUsd??0);
   if(e.interactionMode!=null&&!['plan','agent','ask','legacy'].includes(e.interactionMode))throw Error('Invalid saved interaction mode.');if(e.basePlanRunId!==undefined){if(!RUN_ID.test(e.basePlanRunId))throw Error('Invalid planning readiness context');event.basePlanRunId=e.basePlanRunId;}event.interactionMode=e.interactionMode||'legacy';interactionMode=event.interactionMode;event.conversation=e.conversation===true;event.summarizeGoal=e.summarizeGoal===true;summaryRequested=event.summarizeGoal;event.automaticGoalSummary=e.automaticGoalSummary===true;automaticSummary=event.automaticGoalSummary;if(automaticSummary&&(!event.conversation||interactionMode!=='plan'))throw Error('Invalid automatic goal summary');if(summaryRequested&&(!event.conversation||interactionMode!=='plan'))throw Error('Invalid goal summary request');if(event.conversation&&interactionMode!=='plan')throw Error('Invalid saved conversation mode.');
  }
  if(e.type==='plan.created'){const a=run.events.find(x=>x.type==='run.started')?.agentIterationRequest;if(a&&(e.agentIteration?.iterationRunId!==b.id||JSON.stringify(e.agentIteration.basis)!==JSON.stringify(a)))throw Error('Agent execution brief binding changed');
   Object.assign(event,implementationProfileFields(e),planningReadinessEvidenceFields(e),storedPlanArtifactFields(e),documentPlanFields(e),documentDesignLineageFields(e));
   if(e.refinementHandoff!==undefined)event.refinementHandoff=safeRefinementHandoff(e);
   Object.assign(event,safeRemoteStudyFields(e));
   if(planned)throw Error('Duplicate saved plan.');Object.assign(event,requiredCapabilityFields(e));planned=true;event.tasks=planTasks(e.tasks);tasks=new Set(event.tasks.map(t=>t.id));planTaskRecords=event.tasks;event.goal=text(e.goal||'',6000);Object.assign(event,savedGoalMetadata(e));if(e.assistantMessage!=null)event.assistantMessage=text(e.assistantMessage,1200);
   if(e.originalGoal!=null){if(!RUN_ID.test(e.originalGoalRunId))throw Error('Invalid original goal provenance');event.originalGoal=text(e.originalGoal,6000);event.originalGoalRunId=e.originalGoalRunId;}if(e.goalRevision!=null)event.goalRevision=savedRevision(e.goalRevision);if(e.revisionOf!=null)event.revisionOf=savedRevision(e.revisionOf);if(e.restoreOf!=null)event.restoreOf=savedPlanRestore(e.restoreOf);if(e.draftRefinement!=null){event.draftRefinement=savedRevision(e.draftRefinement);if(JSON.stringify(event.draftRefinement)!==JSON.stringify(event.revisionOf)||event.restoreOf||e.branchOf)throw Error('Invalid draft refinement lineage');}
   if(e.expansionOf!=null){const x=e.expansionOf;if(!object(x)||Object.keys(x).some(k=>!['runId','eventSequence','originTaskId','planRevision'].includes(k))||!RUN_ID.test(x.runId||'')||!Number.isSafeInteger(x.eventSequence)||x.eventSequence<1||!isWorkflowTaskId(x.originTaskId)||!/^[a-f0-9]{64}$/.test(x.planRevision||'')||event.revisionOf?.proposalRunId!==x.runId)throw Error('Invalid saved task expansion provenance.');event.expansionOf={runId:x.runId,eventSequence:x.eventSequence,originTaskId:x.originTaskId,planRevision:x.planRevision};}
   if(e.linkedRestore!=null){const x=e.linkedRestore;if(!object(x)||Object.keys(x).some(k=>!['reviewId','sourceRunId','sourceRevision'].includes(k))||!/^linked_[a-f0-9-]{36}$/.test(x.reviewId||'')||!RUN_ID.test(x.sourceRunId||'')||!/^[a-f0-9]{64}$/.test(x.sourceRevision||'')||!event.restoreOf)throw Error('Invalid linked restore provenance.');event.linkedRestore={reviewId:x.reviewId,sourceRunId:x.sourceRunId,sourceRevision:x.sourceRevision};}
   if(!['plan','agent','legacy'].includes(e.interactionMode||'legacy'))throw Error('Invalid saved plan mode.');event.interactionMode=e.interactionMode||'legacy';event.needsDesignDraft=e.needsDesignDraft===true;
   if(e.sourceRevision!=null){if(typeof e.sourceRevision!=='string'||!e.sourceRevision.length||e.sourceRevision.length>160)throw Error('Invalid saved source revision.');event.sourceRevision=e.sourceRevision;}
   if(e.clarificationQuestions!=null){if(!Array.isArray(e.clarificationQuestions)||e.clarificationQuestions.length>3||e.clarificationQuestions.some(q=>typeof q!=='string'||!q.trim()||q.length>240))throw Error('Invalid saved planning questions.');event.clarificationQuestions=e.clarificationQuestions.map(q=>text(q,240));}Object.assign(event,clarificationChoiceFields(e));
   if(e.clarificationHistory!=null){if(!Array.isArray(e.clarificationHistory)||e.clarificationHistory.length>5)throw Error('Invalid clarification history.');event.clarificationHistory=e.clarificationHistory.map(h=>{if(!object(h)||!RUN_ID.test(h.basePlanRunId)||!Array.isArray(h.questions)||!h.questions.length||h.questions.length>3||h.questions.some(q=>typeof q!=='string'||!q.trim()||q.length>240)||typeof h.answer!=='string'||!h.answer.trim()||h.answer.length>3000||h.sourceRevision!==null&&(typeof h.sourceRevision!=='string'||!h.sourceRevision.length||h.sourceRevision.length>160))throw Error('Invalid clarification history entry.');return {basePlanRunId:h.basePlanRunId,questions:h.questions.map(q=>text(q,240)),answer:text(h.answer,3000),sourceRevision:h.sourceRevision};});}
   event.architecture=e.architecture==null?null:cleanArchitecture(e.architecture);Object.assign(event,safePlanBranchFields({...e,tasks:event.tasks,architecture:event.architecture},{taskCleaner:planTasks,architectureCleaner:cleanArchitecture,textCleaner:text}));validateTaskComponentBindings(event.tasks,event.architecture);if(event.branchBaseTasks)validateTaskComponentBindings(event.branchBaseTasks,Object.hasOwn(event,'branchBaseArchitecture')?event.branchBaseArchitecture:event.architecture);
  }
  if(e.type==='continuation.created'){
   const list=v=>Array.isArray(v)&&v.length<=MAX_WORKFLOW_TASKS&&new Set(v).size===v.length&&v.every(id=>tasks.has(id));
   if(continuation||recovery||workerEventSeen||!planned||interactionMode!=='agent'||!RUN_ID.test(e.originalRunId)||!RUN_ID.test(e.recoveryRunId)||!RUN_ID.test(e.originalPlanRunId)||[e.originalRunId,e.recoveryRunId,e.originalPlanRunId].includes(b.id)||e.originalRunId===e.recoveryRunId||e.attempt!==1||e.maxAttempts!==1||!list(e.seedTaskIds)||!e.seedTaskIds.length||!list(e.remainingTaskIds)||!e.remainingTaskIds.length||e.seedTaskIds.some(id=>e.remainingTaskIds.includes(id))||e.seedTaskIds.length+e.remainingTaskIds.length!==tasks.size||typeof e.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(e.snapshotHash)||!Array.isArray(e.seedProvenance)||e.seedProvenance.length!==e.seedTaskIds.length)throw Error('Invalid saved continuation partition.');
   const seen=new Set(),provenance=e.seedProvenance.map(p=>{if(!object(p)||!e.seedTaskIds.includes(p.taskId)||seen.has(p.taskId)||!['completed','repaired'].includes(p.kind)||!isWorkflowTaskId(p.sourceTaskId)||p.runId!==(p.kind==='repaired'?e.recoveryRunId:e.originalRunId)||p.kind==='completed'&&p.sourceTaskId!==p.taskId||p.kind==='repaired'&&p.sourceTaskId!=='t1')throw Error('Invalid saved seed provenance.');seen.add(p.taskId);return {taskId:p.taskId,runId:p.runId,sourceTaskId:p.sourceTaskId,kind:p.kind};});
   if(provenance.filter(p=>p.kind==='repaired').length!==1||planTaskRecords.some(t=>e.seedTaskIds.includes(t.id)&&t.dependencies.some(id=>!e.seedTaskIds.includes(id))))throw Error('Invalid saved seed dependency closure.');
   continuation={originalRunId:e.originalRunId,recoveryRunId:e.recoveryRunId,originalPlanRunId:e.originalPlanRunId,seedTaskIds:[...e.seedTaskIds],remainingTaskIds:[...e.remainingTaskIds],seedProvenance:provenance,snapshotHash:e.snapshotHash};Object.assign(event,continuation,{attempt:1,maxAttempts:1});
  }
  if(e.parentTaskId)workerEventSeen=true;
  if(e.taskId&&(e.type.startsWith('task.')||['artifacts.created','checkpoint.created','validation.completed','tool.started','tool.completed','tool.failed','model.response','context.prepared'].includes(e.type)))workerEventSeen=true;
  if(continuation){
   if(e.parentTaskId&&!continuation.remainingTaskIds.includes(e.parentTaskId))throw Error('Seed agent was not dispatched.');
   if(e.type==='validation.completed'&&e.checks?.includes('artifact_schema'))continuationValidated.add(e.taskId);
   if(e.taskId&&!continuation.remainingTaskIds.includes(e.taskId))throw Error('Seed task was not dispatched in continuation.');
   if(e.type==='task.started'){const t=planTaskRecords.find(t=>t.id===e.taskId);if(continuationFailed.size||dispatchedTasks.has(e.taskId)||t.dependencies.some(id=>!continuation.seedTaskIds.includes(id)&&!completedTasks.has(id)))throw Error('Invalid continuation dispatch order.');dispatchedTasks.add(e.taskId);}
   if(e.type==='task.completed'&&(!artifactTasks.has(e.taskId)||!continuationValidated.has(e.taskId)||continuationFailed.has(e.taskId)))throw Error('Continuation task completed before validation.');
   if(e.type==='task.failed')continuationFailed.add(e.taskId);
   if(['task.completed','task.failed','artifacts.created','checkpoint.created','validation.completed'].includes(e.type)&&!dispatchedTasks.has(e.taskId))throw Error('Undispatched continuation task.');
  }
  if(e.type==='continuation.completed'){
   if(!continuation||continuationDone||continuationFailed.size||['originalRunId','recoveryRunId','originalPlanRunId'].some(k=>e[k]!==continuation[k])||JSON.stringify(e.remainingTaskIds)!==JSON.stringify(continuation.remainingTaskIds)||JSON.stringify(e.completedTaskIds)!==JSON.stringify(continuation.remainingTaskIds)||continuation.remainingTaskIds.some(id=>!completedTasks.has(id)||!artifactTasks.has(id)||!continuationValidated.has(id))||e.execution!=='not_run'||e.tests!=='not_run')throw Error('Invalid continuation completion.');
   Object.assign(event,{originalRunId:e.originalRunId,recoveryRunId:e.recoveryRunId,originalPlanRunId:e.originalPlanRunId,remainingTaskIds:[...e.remainingTaskIds],completedTaskIds:[...e.completedTaskIds],execution:'not_run',tests:'not_run'});continuationDone=true;
  }
  if(e.type==='run.completed'&&(continuation||e.meaning==='continuation_artifacts_authored')){if(!continuationDone||e.meaning!=='continuation_artifacts_authored'||e.execution!=='not_run'||e.tests!=='not_run'||e.verified!==false)throw Error('Invalid continuation terminal.');event.verified=false;}
  if(e.type==='recovery.created'){
   if(recovery||!planned||interactionMode!=='agent'||tasks.size!==1||e.taskId!=='t1'||!RUN_ID.test(e.originalRunId)||e.originalRunId===b.id||!RUN_ID.test(e.originalPlanRunId)||!isWorkflowTaskId(e.originalTaskId)||e.attempt!==1||e.maxAttempts!==1)throw Error('Invalid saved recovery binding.');
   recovery={originalRunId:e.originalRunId,originalTaskId:e.originalTaskId,originalPlanRunId:e.originalPlanRunId};Object.assign(event,recovery,{attempt:1,maxAttempts:1});
  }
  if(e.type==='package.options_warning')Object.assign(event,safePackageOptionsWarning(e));
  if(e.type==='package.options')Object.assign(event,validatePackageOptionsOrigin(e,run.events));
  if(e.type==='package.progress'&&!packageGuard)throw Error('Package progress requires approved package strategy.');
  if(packageGuard)Object.assign(event,packageGuard(e));
  if(e.sourceVerification!==undefined&&!packageGuard){
   const sourceStart=run.events.find(x=>x.type==='project.generating');
   if(e.type!=='validation.completed'||e.taskId||e.checks!==undefined||projectStrategy!=='staged-artifacts-v1'||projectGenerated||draftActive.size||draftFailed.size||completedTasks.size!==tasks.size||!agents.has(b.id+':project-author')||e.execution!=='not_run'||e.tests!=='not_run'||e.verified!==false)throw Error('Invalid source verification stage.');
   event.verified=false;event.sourceVerification=safeSourceVerification(e.sourceVerification,{runId:b.id,sessionId:b.sessionId,planRunId:projectPlanId,planRevision:sourceStart.planRevision,baseRevision:projectBaseRevision});
  }
  if(projectStrategy==='staged-artifacts-v1'){
   if(e.taskId&&e.agentId&&e.agentId!==b.id+':worker:'+e.taskId)throw Error('Invalid project draft agent binding.');
   if(e.type==='task.started'){const t=planTaskRecords.find(t=>t.id===e.taskId);if(!t||e.agentId!==b.id+':worker:'+e.taskId||draftStarted.has(e.taskId)||draftActive.size>=2||draftFailed.size||t.dependencies.some(id=>!completedTasks.has(id)))throw Error('Invalid project draft dispatch order.');draftStarted.add(e.taskId);draftActive.add(e.taskId);}
   if(e.type==='validation.completed'&&e.checks?.includes('artifact_schema'))draftValidated.add(e.taskId);
   if(e.type==='task.completed'){if(!draftActive.has(e.taskId)||!artifactTasks.has(e.taskId)||!draftValidated.has(e.taskId)||draftFailed.has(e.taskId)||e.meaning!=='draft_authored'||e.verified!==false)throw Error('Invalid project draft completion.');draftActive.delete(e.taskId);}
   if(e.type==='task.failed'){if(!draftActive.has(e.taskId))throw Error('Undispatched project draft failed.');draftActive.delete(e.taskId);draftFailed.add(e.taskId);}
   if(['task.completed','artifacts.created','validation.completed'].includes(e.type)&&!event.sourceVerification&&!draftStarted.has(e.taskId))throw Error('Undispatched project draft event.');
   if(['plan.branches_proposed','plan.branches_rejected'].includes(e.type)){
    if(!draftActive.has(e.taskId)||!artifactTasks.has(e.taskId)||!draftValidated.has(e.taskId)||branchOrigins.has(e.taskId)||e.agentId!==b.id+':worker:'+e.taskId||e.lineage?.nodeId!==e.taskId)throw Error('Invalid saved worker branch origin');
    branchOrigins.add(e.taskId);
    if(e.type==='plan.branches_proposed'){
     const start=run.events.find(x=>x.type==='project.generating'),architecture=run.events.find(x=>x.type==='plan.created')?.architecture??null;
     if(++branchCount>MAX_WORKER_BRANCH_PROPOSALS||e.planRunId!==projectPlanId||e.planRevision!==start?.planRevision||e.baseSourceRevision!==(start?.baseSourceRevision??null)||e.lineage?.goalRevision!==projectPlanId||e.lineage?.planRevision!==start?.planRevision)throw Error('Invalid saved worker branch lineage');
     Object.assign(event,{planRunId:e.planRunId,planRevision:e.planRevision,baseSourceRevision:e.baseSourceRevision,alternatives:safePlanBranchFields({tasks:planTaskRecords,architecture,alternatives:validateWorkerBranches(e.alternatives,planTaskRecords,architecture,e.taskId)},{taskCleaner:planTasks,architectureCleaner:cleanArchitecture,textCleaner:text}).alternatives});
    }else if(!['invalid_branch_proposal','branch_proposal_limit'].includes(e.code))throw Error('Invalid saved worker branch rejection');
   }
   if(e.type==='expansion.proposed'||e.type==='expansion.rejected'){
    if(!draftActive.has(e.taskId)||!artifactTasks.has(e.taskId)||!draftValidated.has(e.taskId)||expansionOrigins.has(e.taskId)||e.agentId!==b.id+':worker:'+e.taskId)throw Error('Invalid saved expansion origin.');
    expansionOrigins.add(e.taskId);
    if(e.type==='expansion.proposed'){
     const start=run.events.find(x=>x.type==='project.generating');if(++expansionCount>MAX_EXPANSIONS_PER_RUN||e.planRunId!==projectPlanId||e.planRevision!==start?.planRevision||e.lineage?.goalRevision!==projectPlanId||e.lineage?.planRevision!==start?.planRevision)throw Error('Invalid saved expansion lineage.');
     event.planRunId=e.planRunId;event.planRevision=e.planRevision;event.proposal=validateTaskExpansion(e.proposal,planTaskRecords,e.taskId);
    }else if(!['invalid_task_expansion','expansion_limit'].includes(e.code))throw Error('Invalid saved expansion rejection.');
   }
  }
  else if(['expansion.proposed','expansion.rejected','plan.branches_proposed','plan.branches_rejected'].includes(e.type))throw Error('Expansion requires a staged project run.');
  if(e.type==='validation.completed'&&e.checks?.includes('architecture_schema'))validatedTasks.add(e.taskId);
  if(e.type==='task.completed')completedTasks.add(e.taskId);
  if(e.type==='recovery.completed'){
   if(!recovery||recoveryDone||e.taskId!=='t1'||!completedTasks.has('t1')||!validatedTasks.has('t1')||!architectureTasks.has('t1')||Object.keys(recovery).some(k=>e[k]!==recovery[k])||e.continuation!=='requires_explicit_action'||!Array.isArray(e.dependentTaskIds)||e.dependentTaskIds.length>MAX_WORKFLOW_DEPENDENCIES||new Set(e.dependentTaskIds).size!==e.dependentTaskIds.length||e.dependentTaskIds.some(id=>!isWorkflowTaskId(id)||id===recovery.originalTaskId))throw Error('Invalid saved recovery completion.');
   Object.assign(event,recovery,{dependentTaskIds:[...e.dependentTaskIds],continuation:e.continuation});recoveryDone=true;
  }
  if(e.type==='run.completed'&&(recovery||e.meaning==='architecture_recovery_authored')&&(!recoveryDone||e.meaning!=='architecture_recovery_authored'))throw Error('Invalid saved recovery terminal.');
  if(e.type==='project.generating'){
   if(!planned||interactionMode!=='agent'||projectPlanId||typeof e.planRunId!=='string'||!RUN_ID.test(e.planRunId)||e.planRunId===b.id)throw Error('Invalid saved project start.');
   if(e.strategy!==undefined&&(!['staged-artifacts-v1','static-react-packages-v1','trusted-declarative-crud-v1'].includes(e.strategy)||workerEventSeen||typeof e.planRevision!=='string'||!/^[a-f0-9]{64}$/.test(e.planRevision)))throw Error('Invalid saved project strategy.');
   if(e.pauseAtDecisionOptions!==undefined){if(typeof e.pauseAtDecisionOptions!=='boolean')throw Error('Invalid decision pause preference');event.pauseAtDecisionOptions=e.pauseAtDecisionOptions;}projectPlanId=e.planRunId;event.planRunId=e.planRunId;if(e.strategy){projectStrategy=e.strategy;event.strategy=e.strategy;event.planRevision=e.planRevision;if(e.baseSourceRevision!==undefined){if(e.baseSourceRevision!==null&&!/^[a-f0-9]{64}$/.test(e.baseSourceRevision))throw Error('Invalid project base revision.');projectBaseRevision=e.baseSourceRevision;event.baseSourceRevision=projectBaseRevision;}}
  }
  if(e.type==='project.generating'&&projectStrategy==='trusted-declarative-crud-v1'&&tasks.size!==1)throw Error('Invalid declarative task count.');
  if(e.type==='project.generating'&&projectStrategy==='static-react-packages-v1'){
   if(e.scope!=='static_frontend_only'||e.goalCompletion!=='not_established'||tasks.size>24||run.events[0]?.strategyAdmission?.planRunId!==projectPlanId||run.events[0]?.strategyAdmission?.packageCount!==(run.events[0]?.strategyAdmission?.terminalContinuation?.remainingTaskIds.length??tasks.size))throw Error('Invalid package scope.');event.scope=e.scope;event.goalCompletion=e.goalCompletion;
   if(JSON.stringify(e.terminalContinuation??null)!==JSON.stringify(run.events[0]?.strategyAdmission?.terminalContinuation??null))throw Error('Invalid continuation admission binding.');
   packageGuard=createPackageRecoveryGuard({runId:b.id,sessionId:b.sessionId,planRunId:projectPlanId,planRevision:e.planRevision,baseRevision:projectBaseRevision,tasks:planTaskRecords,adaptiveWorkflow:e.adaptiveWorkflow===true,adaptiveStart:e,terminalContinuation:e.terminalContinuation||null,sourceBaseAdoption:safePackageSourceBase(e),refinementHandoff:safeRefinementHandoff(e)});if(e.refinementHandoff!==undefined)event.refinementHandoff=safeRefinementHandoff(e);if(e.sourceBaseAdoption!==undefined)event.sourceBaseAdoption=safePackageSourceBase(e);
  }
  if(e.type==='project_recovery.created'){
   const allowed=['invalid_fields','invalid_string','incomplete_project','invalid_base_revision','invalid_source_tasks','file_limit','unsafe_path','sensitive_path','path_collision','invalid_text','byte_limit','missing_entrypoints','missing_entrypoint_file','invalid_dependencies','invalid_verification_intents','metadata_limit','stale_revision','model_output_not_json'];
   const validAttempt=e.attempt===1&&[1,2].includes(e.maxAttempts)&&e.priorRepairRunId===undefined&&e.firstRepairRunId===undefined&&e.format===undefined||e.attempt===2&&e.maxAttempts===2&&RUN_ID.test(e.priorRepairRunId)&&![e.originalRunId,e.originalPlanRunId,b.id].includes(e.priorRepairRunId)&&e.firstRepairRunId===undefined&&e.format===undefined||Number.isSafeInteger(e.attempt)&&e.attempt>=3&&e.attempt<=258&&e.maxAttempts===null&&e.format==='schema_guided_submission'&&e.retryPolicy==='one_call_per_review'&&RUN_ID.test(e.priorRepairRunId)&&RUN_ID.test(e.firstRepairRunId)&&new Set([e.originalRunId,e.originalPlanRunId,e.priorRepairRunId,e.firstRepairRunId,b.id]).size===5;
   if(projectRecovery||!projectPlanId||projectGenerated||agents.size||workerEventSeen||e.originalPlanRunId!==projectPlanId||!RUN_ID.test(e.originalRunId)||e.originalRunId===b.id||!allowed.includes(e.diagnosticCode)||e.baseRevision!==null&&(typeof e.baseRevision!=='string'||!/^[a-f0-9]{64}$/.test(e.baseRevision))||typeof e.policyHash!=='string'||!/^[a-f0-9]{64}$/.test(e.policyHash)||!validAttempt||typeof e.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(e.snapshotHash))throw Error('Invalid saved project repair.');
   projectRecovery={originalRunId:e.originalRunId,originalPlanRunId:e.originalPlanRunId,diagnosticCode:e.diagnosticCode,snapshotHash:e.snapshotHash,baseRevision:e.baseRevision,policyHash:e.policyHash,attempt:e.attempt,maxAttempts:e.maxAttempts,...(e.priorRepairRunId?{priorRepairRunId:e.priorRepairRunId}:{}),...(e.firstRepairRunId?{firstRepairRunId:e.firstRepairRunId,format:e.format,retryPolicy:e.retryPolicy}:{})};Object.assign(event,projectRecovery);
  }
  if(projectRecovery&&(e.type.startsWith('task.')||e.type==='artifacts.created'))throw Error('Project repair cannot execute workflow tasks.');
  if(e.type==='project_recovery.completed'){
   if(!projectRecovery||projectRecoveryDone||!projectGenerated||Object.keys(projectRecovery).some(k=>e[k]!==projectRecovery[k])||e.revision!==projectRevision)throw Error('Invalid saved project repair completion.');Object.assign(event,projectRecovery,{revision:e.revision});projectRecoveryDone=true;
  }
  if(e.type==='run.completed'&&projectRecovery&&!projectRecoveryDone)throw Error('Project repair publication was not confirmed.');
  if(e.type==='work.progress'){if(!WORK_PHASES.includes(e.phase)||e.fileCount!=null&&(!Number.isInteger(e.fileCount)||e.fileCount<0||e.fileCount>200))throw Error('Invalid saved work progress.');event.phase=e.phase;if(e.fileCount!=null)event.fileCount=e.fileCount;}
  if(e.type==='project.generated'){
   if(!projectPlanId||projectGenerated||e.planRunId!==projectPlanId||e.status!=='generated_unverified'||e.execution!=='not_run'||e.tests!=='not_run'||!Number.isInteger(e.fileCount)||e.fileCount<1||e.fileCount>200||typeof e.revision!=='string'||!/^[a-f0-9]{64}$/.test(e.revision)||typeof e.planRevision!=='string'||!/^[a-f0-9]{64}$/.test(e.planRevision))throw Error('Invalid saved project result.');
   if(projectStrategy==='staged-artifacts-v1'&&(draftFailed.size||completedTasks.size!==tasks.size||e.planRevision!==run.events.find(x=>x.type==='project.generating')?.planRevision))throw Error('Project draft prerequisites incomplete.');
   const projectPath=p=>typeof p==='string'&&p.length<=240&&/^[A-Za-z0-9_.@+/-]+$/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..'||/[.]$/.test(x)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(x)||/^(\.git|\.env(?:\..*)?|\.ssh|\.aws|\.local-data|node_modules|credentials(?:\..*)?|secrets(?:\..*)?|budget(?:\..*)?)$/i.test(x))&&!/\.(pem|key|p12|pfx)$/i.test(p);
   if(e.files!=null){if(!Array.isArray(e.files)||e.files.length!==e.fileCount||e.files.some(p=>!safeJournalPath(p))||new Set(e.files).size!==e.files.length)throw Error('Invalid saved project file list.');event.files=[...e.files];}
   const fields=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
   if(!Array.isArray(e.entrypoints)||!e.entrypoints.length||e.entrypoints.length>20||!Array.isArray(e.dependencies)||e.dependencies.length>200||!Array.isArray(e.verificationIntents)||e.verificationIntents.length>40)throw Error('Invalid saved project metadata.');
   event.entrypoints=e.entrypoints.map(v=>{if(!fields(v,['path','purpose'])||!projectPath(v.path))throw Error('Invalid saved project entrypoint.');return {path:v.path,purpose:text(v.purpose,500)};});
   event.dependencies=e.dependencies.map(v=>{if(!fields(v,['name','version','ecosystem']))throw Error('Invalid saved project dependency.');return {name:text(v.name,240),version:text(v.version,240),ecosystem:text(v.ecosystem,60)};});
   event.verificationIntents=e.verificationIntents.map(v=>{if(!fields(v,['id','description','status'])||v.status!=='not_run')throw Error('Invalid saved project verification.');return {id:text(v.id,80),description:text(v.description,1000),status:'not_run'};});
   Object.assign(event,{planRunId:projectPlanId,planRevision:e.planRevision,revision:e.revision,fileCount:e.fileCount,status:'generated_unverified',execution:'not_run',tests:'not_run'});projectGenerated=true;projectRevision=e.revision;
  }
  if(projectPlanId&&!['staged-artifacts-v1','static-react-packages-v1','trusted-declarative-crud-v1'].includes(projectStrategy)&&e.type==='task.completed')throw Error('Project source generation cannot complete workflow tasks.');
  if(e.type==='run.completed'&&(projectPlanId||e.meaning==='project_files_generated')){
   if(!projectGenerated||e.meaning!==(projectStrategy==='trusted-declarative-crud-v1'?'declarative_schema_published':packageGuard?'source_packages_compiled':'project_files_generated')||e.execution!=='not_run'||e.tests!=='not_run'||e.verified!==false)throw Error('Invalid saved project completion.');event.verified=false;
  }
  if(e.type.startsWith('steering.')){if(!planned||!tasks.has(e.targetTaskId))throw Error('Unknown saved steering target.');event.targetTaskId=e.targetTaskId;if(e.activeTaskIds!=null){if(!Array.isArray(e.activeTaskIds)||e.activeTaskIds.length>MAX_WORKFLOW_TASKS||new Set(e.activeTaskIds).size!==e.activeTaskIds.length||e.activeTaskIds.some(id=>!tasks.has(id)))throw Error('Invalid saved steering active tasks.');event.activeTaskIds=[...e.activeTaskIds];}}
  if(e.type==='agent.started'){if(!event.agentId||agents.has(event.agentId)||!['planner','implementation','research','review','project author'].includes(e.role))throw Error('Invalid saved agent start.');if((e.role==='project author')!==(event.agentId===b.id+':project-author')||e.role==='project author'&&!projectPlanId||e.role==='project author'&&projectStrategy==='staged-artifacts-v1'&&(draftFailed.size||draftActive.size||completedTasks.size!==tasks.size)||projectStrategy==='staged-artifacts-v1'&&e.parentTaskId&&(event.agentId!==b.id+':worker:'+e.parentTaskId||!draftActive.has(e.parentTaskId)))throw Error('Invalid saved project agent.');agents.add(event.agentId);event.role=e.role;}
  if(e.type==='agent.completed'&&(!event.agentId||!agents.has(event.agentId)))throw Error('Unknown saved agent completion.');
  if(e.type.startsWith('task.')&&!event.taskId)throw Error('Missing saved task.');
  if(e.type.startsWith('tool.')&&(!event.invocationId||!event.name))throw Error('Missing saved operation.');
  if(e.type==='tool.started'){if(invocations.has(event.invocationId))throw Error('Duplicate saved invocation.');invocations.add(event.invocationId);}
  if(['tool.completed','tool.failed','model.response'].includes(e.type)){if(!event.invocationId||!invocations.has(event.invocationId)||finishedInvocations.has(event.invocationId))throw Error('Unknown saved invocation result.');if(e.type!=='model.response')finishedInvocations.add(event.invocationId);}
  if(e.type==='artifacts.created'){
   if(!event.taskId||artifactTasks.has(event.taskId)||!Array.isArray(e.artifacts)||!e.artifacts.length||e.artifacts.length>2)throw Error('Invalid saved artifacts.');artifactTasks.add(event.taskId);let size=0;const paths=new Set();
   if(e.draft!==undefined&&(e.draft!==true||projectStrategy!=='staged-artifacts-v1'))throw Error('Invalid draft provenance.');if(projectStrategy==='staged-artifacts-v1'&&e.draft!==true)throw Error('Missing draft provenance.');if(e.draft)event.draft=true;
   event.artifacts=e.artifacts.map(a=>{
    if(!object(a)||!validPath(a.path)||a.path.length>120||paths.has(a.path)||typeof a.content!=='string')throw Error('Invalid saved artifact.');paths.add(a.path);size+=bytes(a.content);if(size>16000)throw Error('Oversized saved artifact.');
    if(a.architecture&&cleanArchitecture(a.architecture).kind==='components')architectureTasks.add(event.taskId);
    return {path:a.path,content:text(a.content,16000),language:text(a.language||'text',30),...(a.architecture?{architecture:cleanArchitecture(a.architecture)}:{}),validation:{schema:'passed',execution:'not_run',tests:'not_run'}};
   });
  }
  if(e.type==='checkpoint.created'){if(!event.taskId)throw Error('Missing checkpoint task.');event.checkpoint=checkpoint(e.checkpoint);}
  if(e.type==='message.answer'){
   Object.assign(event,implementationProfileFields(e),planningReadinessEvidenceFields(e),storedPlanArtifactFields(e),documentPlanFields(e),documentDesignLineageFields(e));
   event.text=text(e.text,3000);if(e.originalGoal!=null){if(!RUN_ID.test(e.originalGoalRunId))throw Error('Invalid original goal provenance');event.originalGoal=text(e.originalGoal,6000);event.originalGoalRunId=e.originalGoalRunId;event.legacyGoalRecovered=e.legacyGoalRecovered===true;}event.summary='Saved read-only answer: '+event.text;
   if(e.basePlanRunId!=null){if(!RUN_ID.test(e.basePlanRunId))throw Error('Invalid conversation plan binding');event.basePlanRunId=e.basePlanRunId;}
  }
  if(e.type==='goal.summarized'){
   if((!summaryRequested&&!automaticSummary)||summarySeen||planned||!RUN_ID.test(e.basePlanRunId))throw Error('Invalid saved goal summary');summarySeen=true;
   const metadata=savedGoalMetadata(e);if(!metadata.goalTitle||!metadata.goalSummary)throw Error('Incomplete saved goal summary');
   if(e.sourceRevision!=null&&(typeof e.sourceRevision!=='string'||e.sourceRevision.length>160))throw Error('Invalid goal summary source');
   Object.assign(event,metadata,{basePlanRunId:e.basePlanRunId,originalGoal:text(e.originalGoal,6000),sourceRevision:e.sourceRevision||null});
  }
  if(e.type==='plan.proposed'){
   if(summaryRequested)throw Error('Goal summary cannot propose a revision');
   if(interactionMode!=='plan'||!RUN_ID.test(e.basePlanRunId)||!object(e.proposal))throw Error('Invalid saved proposal');
   const p=e.proposal;event.basePlanRunId=e.basePlanRunId;
   if(Object.hasOwn(p,'planArtifact')&&Object.hasOwn(p,'summary')&&(typeof p.summary!=='string'||!p.summary.trim()||p.summary.length>1000))throw Error('Invalid saved proposal summary');
   if(p.sourceRevision!=null&&(typeof p.sourceRevision!=='string'||p.sourceRevision.length>160))throw Error('Invalid proposal source revision');
   if(!Array.isArray(p.clarificationQuestions)||p.clarificationQuestions.length>3)throw Error('Invalid proposal questions');
   event.proposal={...implementationProfileFields(p),...storedPlanArtifactFields(p),...planningReadinessEvidenceFields(p),...requiredCapabilityFields(p),...(Object.hasOwn(p,'planArtifact')&&!Object.hasOwn(p,'summary')?{}:{summary:text(p.summary,1000)}),goal:text(p.goal,6000),...savedGoalMetadata(p),...(p.goalRevision?{goalRevision:savedRevision(p.goalRevision)}:{}),...(p.goalUpdate?{goalUpdate:savedGoalUpdate(p.goalUpdate)}:{}),tasks:planTasks(p.tasks),architecture:p.architecture==null?null:cleanArchitecture(p.architecture),...safePlanBranchFields(p,{taskCleaner:planTasks,architectureCleaner:cleanArchitecture,textCleaner:text}),clarificationQuestions:p.clarificationQuestions.map(q=>text(q,240)),...clarificationChoiceFields(p),sourceRevision:p.sourceRevision||null,needsDesignDraft:p.needsDesignDraft===true};validateTaskComponentBindings(event.proposal.tasks,event.proposal.architecture);if(event.proposal.branchBaseTasks)validateTaskComponentBindings(event.proposal.branchBaseTasks,Object.hasOwn(event.proposal,'branchBaseArchitecture')?event.proposal.branchBaseArchitecture:event.proposal.architecture);
  }
  if(['run.completed','run.failed','run.cancelled'].includes(e.type))terminal=true;
  run.events.push(event);
 }
 return run;
}
function markRecovered(s,run){
 const live=s.liveRun;live.recovered=true;live.serverObserved=true;live.active=run.status==='running'&&run.active;live.status=run.status==='running'&&!run.active?'interrupted':run.status;live.reservedUsd=run.reservedUsd;live.chargedUsd=run.chargedUsd;
 if(live.status==='interrupted'){live.error='Process interrupted; reservation retained. No automatic restart.';s.workflow.mode='blocked';}
 for(const r of s.runs||[])if(r.id===run.id)Object.assign(r,{status:run.status,reservedUsd:run.reservedUsd,chargedUsd:run.chargedUsd,historical:true,serverObserved:true,active:live.active});
 for(const e of s.events||[])if(e.runId===run.id)Object.assign(e,{historical:true,serverObserved:true});
 for(const a of s.agents||[])if(a.provenance?.runId===run.id)Object.assign(a.provenance,{historical:true,serverObserved:true,origin:'Recovered local-server record'});
 for(const a of s.artifacts||[])if(a.runId===run.id)Object.assign(a,{historical:true,serverObserved:true});
 for(const c of [...s.checkpoints||[],...s.fileCheckpoints||[]])if(c.runId===run.id||c.id===run.id+':checkpoint')c.historical=true;
 for(const a of s.architectureOutputs||[])if(a.provenance?.runId===run.id){a.provenance.historical=true;a.provenance.origin='Recovered local-server artifact';}
 if(s.pendingPlan){s.pendingPlan.approved=false;delete s.pendingPlan.selectedAlternative;}s.chatMode='plan';ensurePlanConversationMessage(s);
}
/** Reconcile only the existing observed run, without approving, dispatching or resuming. */
export function reconcileRecoveredRun(s,value){
 const run=validateSavedRun(value,{id:s.liveRun?.runId,sessionId:s.id,status:value?.status});
 if(!s.liveRun?.recovered)throw Error('Not a recovered run.');
 const previous=s.liveRun.lastSequence||0;if(run.events.length<previous)throw Error('Saved history moved backwards.');
 // Validate all records before touching the live session. Replay on a detached candidate.
 const next=structuredClone(s);for(const e of run.events)if(e.sequence>previous)applyLiveEvent(next,e);markRecovered(next,run);Object.assign(s,next);return s;
}
function restoreSession(sessionId,runs,now,partial){
 const s=recoveredSession(sessionId,now);s.recovery.partial=partial;s.recovery.runLimit=RUN_RECOVERY_LIMIT;
 for(const run of runs){
  const plan=run.events.find(e=>e.type==='plan.created'),goal=plan?.goal||'Original request unavailable in saved history';
  s.goal||=plan?.goal||'';s.liveRun={runId:run.id,goal,lastSequence:0,status:'running',mode:'recovered',recovered:true,serverObserved:true};
  for(const event of run.events)applyLiveEvent(s,event);
  s.runs||=[];if(!s.runs.some(r=>r.id===run.id))s.runs.push({id:run.id,status:run.status,model:'Not recorded',mode:'recovered',verification:'not_run'});
  s.workflow||={requests:[],tasks:[],selected:null,mode:'idle',revision:0};markRecovered(s,run);
 }
 if(partial)s.messages.push({role:'assistant',text:'Only the most recent '+RUN_RECOVERY_LIMIT+' missing runs were checked. Earlier runs for this session were not recovered.'});
 return s;
}
async function fetchJSON(fetcher,url,maxBytes){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetcher(url,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
  if(!response.ok)throw Error(response.status===403?'Open Mulo from the local server, then try recovery again.':'Saved local history could not be read.');
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid saved history response.');
  let raw='';if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('Saved history exceeds the recovery size limit.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}else raw=await response.text();
  if(bytes(raw)>maxBytes)throw Error('Saved history exceeds the recovery size limit.');return JSON.parse(raw);
 }finally{clearTimeout(timer);}
}
async function recover(state,fetcher,now){
 const status=await fetchJSON(fetcher,'/api/status',MAX_HISTORY_BYTES);
 if(!object(status)||!Array.isArray(status.runs)||status.runs.length>10000)throw Error('Saved run list is invalid or too large.');
 const existing=new Set(state.sessions.map(s=>s.id)),valid=[],seen=new Set();let invalidRuns=0;
 for(const raw of status.runs){try{const b=binding(raw);if(seen.has(b.id))throw Error('Duplicate saved run.');seen.add(b.id);valid.push(b);}catch{invalidRuns++;}}
 const missing=valid.filter(b=>!existing.has(b.sessionId)),selected=missing.slice(-RUN_RECOVERY_LIMIT),results=new Map();let recoveredBytes=0;
 // Four bounded read-only requests at a time; never call /api/run or /api/approve-plan.
 for(let i=0;i<selected.length;i+=4)await Promise.all(selected.slice(i,i+4).map(async b=>{try{const run=validateSavedRun(await fetchJSON(fetcher,'/api/runs/'+encodeURIComponent(b.id),MAX_HISTORY_BYTES),b);const size=bytes(JSON.stringify(run));if(recoveredBytes+size>MAX_RECOVERY_BYTES)throw Error('Recovery size limit.');recoveredBytes+=size;results.set(b.id,run);}catch{results.set(b.id,null);}}));
 const groups=new Map();for(const b of selected){if(!groups.has(b.sessionId))groups.set(b.sessionId,[]);groups.get(b.sessionId).push(b);}
 const staged=[];let failedSessions=0,failedRuns=0;
 for(const [id,bindings]of groups){if(bindings.some(b=>!results.get(b.id))){failedSessions++;failedRuns+=bindings.filter(b=>!results.get(b.id)).length;continue;}try{const session=restoreSession(id,bindings.map(b=>results.get(b.id)),now,missing.filter(b=>b.sessionId===id).length>bindings.length);if((status.connected===true||status.mock===true)&&['spark','nebius'].includes(status.modelChoice))session.model=status.modelChoice;staged.push(session);}catch{failedSessions++;failedRuns+=bindings.length;}}
 let project=state.projects?.find(p=>p.recoverySource==='local_server'&&!p.archived),recoveredSessions=0,recoveredRuns=0;
 for(const s of staged){
  // User navigation or editing while requests were pending must never overwrite a session.
  if(state.sessions.some(existing=>existing.id===s.id))continue;
  if(!project){project={id:'project_'+crypto.randomUUID(),title:'Recovered',createdAt:now,archived:false,recoverySource:'local_server'};state.projects||=[];state.projects.push(project);}
  s.projectId=project.id;state.sessions.push(s);recoveredSessions++;recoveredRuns+=s.runs.length;
 }
 return {recoveredSessions,recoveredRuns,failedSessions,failedRuns,invalidRuns,omittedRuns:Math.max(0,missing.length-selected.length),checkedRuns:selected.length,limit:RUN_RECOVERY_LIMIT,projectId:project?.id||null,existingSessions:new Set(valid.filter(b=>existing.has(b.sessionId)).map(b=>b.sessionId)).size};
}
/** Concurrent clicks share one operation; additions are staged and existing records are untouched. */
export function recoverSavedRuns(state,{fetcher=globalThis.fetch,now=Date.now()}={}){
 if(activeRecoveries.has(state))return activeRecoveries.get(state);
 if(!state||!Array.isArray(state.sessions)||typeof fetcher!=='function')return Promise.reject(Error('Local workspace unavailable.'));
 const pending=recover(state,fetcher,now).finally(()=>activeRecoveries.delete(state));activeRecoveries.set(state,pending);return pending;
}
export function recoverySummary(result){
 let message=result.recoveredSessions?'Recovered '+result.recoveredRuns+' run(s) in '+result.recoveredSessions+' session(s).':'No missing sessions recovered.';
 if(result.existingSessions)message+=' Existing sessions kept unchanged.';
 if(result.failedSessions)message+=' '+result.failedSessions+' session(s) could not be read safely; try again.';
 if(result.invalidRuns)message+=' '+result.invalidRuns+' invalid run record(s) skipped.';
 if(result.omittedRuns)message+=' Checked the latest '+result.limit+' missing runs; '+result.omittedRuns+' earlier run(s) not checked.';
 return message;
}
