// Inert, owner-reviewed association. An uploaded receipt is never provider verification.
import {createHash} from 'node:crypto';
import {validateStructure} from '../web/structure.js';
import {validateProject} from '../backend/project-output/contract.mjs';
import {validatePlan} from '../backend/orchestrator.mjs';
import {validateStructuredArchitecture} from '../web/architecture-schema.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error(code);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(value,allowed)=>object(value)&&Object.keys(value).every(k=>allowed.includes(k));
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=1_000_000_000;
function currentPlan(associatedPlanRunId,{store,owner,latestPlanId,canonicalPlan,sessionId}){
 if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||!/^run_[A-Za-z0-9-]+$/.test(associatedPlanRunId||''))fail('recorded_plan_unavailable');
 const row=store.db.prepare('SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?').get(associatedPlanRunId,owner,sessionId);
 if(!row||row.status!=='completed'||!row.usage_known||row.reserved!==0)fail('recorded_plan_unavailable');
 if(latestPlanId(sessionId)!==associatedPlanRunId)fail('recorded_plan_stale');
 const plans=store.db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(row.id).map(r=>JSON.parse(r.payload)).filter(e=>e.type==='plan.created'&&e.interactionMode==='plan');
 if(plans.length!==1)fail('recorded_plan_unavailable');
 const p=canonicalPlan({...plans[0],runId:row.id},sessionId);
 if(p.legacyGoalRecovered||typeof p.goal!=='string'||!p.goal.trim())fail('recorded_plan_unavailable');
 if(JSON.stringify(validatePlan({tasks:p.tasks}))!==JSON.stringify(p.tasks))fail('recorded_plan_unavailable');
 if(p.architecture)validateStructuredArchitecture(p.architecture);
 return hash({planRunId:row.id,planChoice:null,tasks:p.tasks,architecture:p.architecture||null,goal:p.goal,sourceRevision:p.sourceRevision||null});
}
function importedReference(value,{store,owner,latestPlanId,sessionId}){
 if(!/^[a-f0-9-]{36}$/.test(sessionId||''))fail('recorded_plan_unavailable');
 if(latestPlanId(sessionId)!==null)fail('recorded_plan_stale');
 if(store.db.prepare('SELECT 1 FROM runs WHERE session_id=? AND owner<>? LIMIT 1').get(sessionId,owner))fail('recorded_plan_unavailable');
 try{return validateStructure(value);}catch{fail('invalid_recorded_imported_plan');}
}
export function assertRecordedAssociation(evidence,context){
 if(!evidence||evidence.compatibility!=='owner_reviewed_not_verified'||evidence.sessionId!==context.sessionId)fail('recorded_plan_changed');
 if(evidence.associationKind==='imported_plan_reference'){
  if(evidence.associatedPlanRunId!==null||hash(importedReference(evidence.importedPlan,context))!==evidence.planRevision)fail('recorded_plan_changed');
 }else if(evidence.associationKind!=='saved_plan'||currentPlan(evidence.associatedPlanRunId,context)!==evidence.planRevision)fail('recorded_plan_changed');
 return true;
}
export function validateRecordedEvidence({sessionId,recordedResult,source,associatedPlanRunId,associatedImportedPlan,acknowledgeUnverifiedAssociation,derivedFromReceipt},context){
 if(acknowledgeUnverifiedAssociation!==true)fail('recorded_association_acknowledgment_required');
 if(derivedFromReceipt!==undefined&&typeof derivedFromReceipt!=='boolean')fail('invalid_recorded_derivation');
 if(!exact(recordedResult,['format','version','source','manifest','pipeline','attemptedCalls','receivedResponses','usage','usageComplete','execution','tests'])||recordedResult.format!=='mulo-source-test-result'||recordedResult.version!==1||recordedResult.execution!=='not_run'||recordedResult.tests!=='not_run')fail('invalid_recorded_result');
 const raw=JSON.stringify(recordedResult);if(Buffer.byteLength(raw)>8_000_000)fail('recorded_result_limit');
 const {source:original,manifest,...metadata}=recordedResult;
 if(Buffer.byteLength(JSON.stringify(metadata))>64000||typeof metadata.pipeline!=='string'||!metadata.pipeline.trim()||metadata.pipeline.length>160||/[\x00-\x1f\x7f]/.test(metadata.pipeline)||!count(metadata.attemptedCalls)||!count(metadata.receivedResponses)||metadata.receivedResponses>metadata.attemptedCalls||typeof metadata.usageComplete!=='boolean')fail('invalid_recorded_metadata');
 if(!exact(metadata.usage,['prompt_tokens','completion_tokens','total_tokens'])||Object.values(metadata.usage).some(v=>!count(v)))fail('invalid_recorded_usage');
 if(metadata.usageComplete&&['prompt_tokens','completion_tokens','total_tokens'].some(k=>!Object.hasOwn(metadata.usage,k)))fail('invalid_recorded_usage');
 if(Object.hasOwn(metadata.usage,'total_tokens')&&Object.hasOwn(metadata.usage,'prompt_tokens')&&Object.hasOwn(metadata.usage,'completion_tokens')&&metadata.usage.total_tokens!==metadata.usage.prompt_tokens+metadata.usage.completion_tokens)fail('invalid_recorded_usage');
 if(!object(manifest)||!object(manifest.source))fail('invalid_recorded_manifest');
 const provenanceStrings=[metadata.pipeline,manifest.source.runId,manifest.source.planRevision,...(Array.isArray(manifest.source.taskIds)?manifest.source.taskIds:[])];
 if(provenanceStrings.some(v=>typeof v!=='string'||/[\x00-\x1f\x7f]|\bBearer\s+\S+|\b(?:api[_ -]?key|authorization|password|secret)\s*[:=]|\bsk-[A-Za-z0-9_-]{8,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(v)))fail('sensitive_recorded_metadata');
 const checked=validateProject(original,manifest.source);if(JSON.stringify(checked.manifest)!==JSON.stringify(manifest))fail('recorded_manifest_mismatch');
 validateProject(source,manifest.source);
 const originalSourceDigest=hash(original),sourceDigest=hash(source),different=originalSourceDigest!==sourceDigest;
 if(different&&derivedFromReceipt!==true)fail('recorded_derivative_acknowledgment_required');
 const imported=associatedImportedPlan!==undefined;
 if(imported&&associatedPlanRunId!==undefined&&associatedPlanRunId!==null)fail('mixed_recorded_association');
 const importedPlan=imported?importedReference(associatedImportedPlan,{...context,sessionId}):null;
 const planRevision=imported?hash(importedPlan):currentPlan(associatedPlanRunId,{...context,sessionId});
 return {format:'mulo-recorded-source-evidence',version:1,sessionId,origin:different?'derived_from_recorded_source':'recorded_source',receiptDigest:hash(recordedResult),originalSourceDigest,sourceDigest,associatedPlanRunId:imported?null:associatedPlanRunId,associationKind:imported?'imported_plan_reference':'saved_plan',...(imported?{importedPlan,importedPlanDigest:planRevision}:{}),planRevision,compatibility:'owner_reviewed_not_verified',providerProvenance:'uploaded_receipt_not_independently_verified',execution:'not_run',tests:'not_run',fileCount:source.files.length,bytes:source.files.reduce((n,f)=>n+Buffer.byteLength(f.content),0),attemptedCalls:metadata.attemptedCalls,receivedResponses:metadata.receivedResponses,usage:structuredClone(metadata.usage),usageComplete:metadata.usageComplete,recordedResult:structuredClone(recordedResult)};
}
