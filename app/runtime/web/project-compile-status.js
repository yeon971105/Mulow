import {resolveAutomaticBuild} from './automatic-build-strategy.js';
import {safeDeclarativeVerification} from './declarative-schema-verification.js';
import {safeSourceVerification} from './source-verification-receipt.js';
export function projectBundleCompiled(session,bundle){
 const current=session?.projectBundles?.at(-1);
 if(!bundle||!current||current.runId!==bundle.runId||current.revision!==bundle.revision||!bundle.planRunId||!bundle.planRevision)return false;
 const events=(session.events||[]).filter(e=>e.runId===bundle.runId&&e.sessionId===session.id);
 if(!events.some(e=>e.type==='run.completed')||events.some(e=>['run.failed','run.cancelled'].includes(e.type)))return false;
 const event=events.findLast(e=>e.type==='validation.completed'&&e.sourceVerification!==undefined);
 if(!event)return false;
 try{const receipt=safeSourceVerification(event.sourceVerification,{runId:bundle.runId,sessionId:session.id,planRunId:bundle.planRunId,planRevision:bundle.planRevision});return receipt.status==='compiled'&&receipt.sourceRevision===bundle.revision;}catch{return false;}
}
export function projectBundleSchemaValidated(session,bundle){
 const current=session?.projectBundles?.at(-1);
 if(!bundle||bundle.strategy!=='trusted-declarative-crud-v1'||current?.runId!==bundle.runId||current?.revision!==bundle.revision)return false;
 const events=(session.events||[]).filter(e=>e.runId===bundle.runId&&e.sessionId===session.id);
 if(events.some(e=>['run.failed','run.cancelled'].includes(e.type))||!events.some(e=>e.type==='run.completed'&&e.meaning==='declarative_schema_published'))return false;
 try{
  const receipt=safeDeclarativeVerification(bundle.declarativeVerification,{runId:bundle.runId,sessionId:session.id,planRunId:bundle.planRunId,planRevision:bundle.planRevision,sourceRevision:bundle.revision});
  const taskId=bundle.runId+':'+receipt.taskId;
  if(!events.some(e=>e.type==='project.generating'&&e.strategy==='trusted-declarative-crud-v1'&&e.planRunId===bundle.planRunId&&e.planRevision===bundle.planRevision))return false;
  return ['validation.completed','task.completed','project.generated'].every(type=>events.some(e=>e.type===type&&(type==='project.generated'||e.taskId===taskId)&&(type!=='task.completed'||e.meaning==='declarative_schema_validated')&&JSON.stringify(safeDeclarativeVerification(e.declarativeVerification))===JSON.stringify(receipt)));
 }catch{return false;}
}
export function projectBundleStatusLabel(session,bundle){return projectBundleSchemaValidated(session,bundle)?'Schema validated · runtime unverified':projectBundleCompiled(session,bundle)?'Source compiled · browser tests not run':'Project files generated — not built or tested';}
export function projectBundleCompletionMessage(session,bundle){return projectBundleStatusLabel(session,bundle)+'. Download the ZIP to inspect the complete source snapshot. '+(projectBundleSchemaValidated(session,bundle)?'The schema-authoring task is validated. Runtime, database persistence and the full goal remain unverified; Run requires separate consent.':'Approved workflow tasks remain unverified.');}
export function currentSourcePublicationFailed(session){
 const runId=session?.liveRun?.runId,plan=session?.pendingPlan;
 if(!runId||session.liveRun.status!=='failed'||!plan||session.projectBundles?.some(b=>b.runId===runId))return false;
 const events=(session.events||[]).filter(e=>e.runId===runId&&e.sessionId===session.id);
 if(!events.some(e=>e.type==='run.failed'&&['source_verification_failed','package_verification_failed'].includes(e.code))||events.some(e=>e.type==='run.completed'))return false;
 const event=events.findLast(e=>e.type==='validation.completed'&&e.sourceVerification!==undefined);
 try{return safeSourceVerification(event?.sourceVerification,{runId,sessionId:session.id,planRunId:plan.runId}).status==='failed';}catch{return false;}
}

export function projectOperationMessageText(session,message){const bundle=session?.projectBundles?.at(-1);return bundle&&typeof bundle.runId==='string'&&message?.role==='status'&&message.kind==='work-operation'&&message.runId===bundle?.runId&&message.id===bundle.runId+':work-operation'&&projectBundleSchemaValidated(session,bundle)?projectBundleCompletionMessage(session,bundle):message?.text;}

// Presentation routing only; the separate review/consent endpoints retain authority.
export function declarativePreviewPrimary(session,current,capability){
 const b=session?.projectBundles?.at(-1),plan=session?.pendingPlan;
 if(capability?.available!==true||capability.profile!=='trusted-declarative-crud-v1'||!plan||plan.stale||!b||current?.status!=='known'||current.runId!==b.runId||current.revision!==b.revision||plan.runId!==b.planRunId||!projectBundleSchemaValidated(session,b))return false;
 try{return resolveAutomaticBuild(plan,{declarativeAvailable:true}).strategy==='trusted-declarative-crud-v1'&&plan.tasks[0].id===b.declarativeVerification.taskId;}catch{return false;}
}
