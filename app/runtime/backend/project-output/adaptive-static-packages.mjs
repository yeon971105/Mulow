import {validateProject,sha256} from './contract.mjs';
import {parsePackageResult} from './package-result.mjs';
import {validateCandidateVerification} from './verification-receipt.mjs';
import {buildStaticPackageMessages} from './static-react-packages.mjs';
const fail=(code)=>{throw Object.assign(Error(code),{code});};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function newDiscoveredWork(queue,proposals){const key=x=>x.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');const queued=new Set(queue.map(x=>key(x.title)));return proposals.filter(x=>!queued.has(key(x.title)));}
const view=b=>({revision:b.manifest.revision,entrypoints:b.manifest.entrypoints,dependencies:b.manifest.dependencies,files:b.files.map(({path,content})=>({path,content}))});
// Each new work item comes from a real complete-source response. It is neither
// a guessed task list nor permission to leave the approved milestone's scope.
export async function runAdaptiveStaticPackages({approved,context,initialSource,initialSourceRevision,invokeModel,verifyCandidate,verifyInitialSource,retainCandidate,onPackage,assertCurrent,signal,boundary,selectNext,maxInputBytes,reservedCalls}){
 const current=async()=>{if(signal?.aborted)fail('run_cancelled');await assertCurrent();if(signal?.aborted)fail('run_cancelled');};
 const ctx=freeze(structuredClone(context));let previous=initialSource?freeze(structuredClone(initialSource)):null,lastOutput=null,lastBundle=null,calls=0;
 const pending=new Map(approved.map(t=>[t.id,t])),completed=new Set(),receipts=[];
 const emit=async x=>{await onPackage(freeze({...x,execution:'not_run',tests:'not_run',browser:'unverified',goalCompletion:'not_established'}));await current();};
 if(previous){await current();if(typeof verifyInitialSource!=='function')fail('package_base_unsupported');const r=await verifyInitialSource({context:ctx,initialSource:previous,signal});await current();const inputs=previous.files.map(f=>({path:f.path,sha256:sha256(f.content),bytes:Buffer.byteLength(f.content)})).sort((a,b)=>a.path.localeCompare(b.path));if(r.status!=='compiled'||r.sourceRevision!==initialSourceRevision||r.sourceFilesDigest!==sha256(JSON.stringify(inputs))||r.execution!=='not_run'||r.tests!=='not_run')fail('package_base_unsupported');}
 while(pending.size){
  await current();await boundary('worker_wave');await current();const task=selectNext?await selectNext(new Map(pending),new Set(completed)):[...pending.values()].find(t=>t.dependencies.every(d=>completed.has(d)));
  if(!task||pending.get(task.id)!==task||!task.dependencies.every(d=>completed.has(d)))fail('package_steering_target_invalid');
  await emit({phase:'started',taskId:task.id,attempt:0,parentCandidateRevision:previous?.handoffCandidateRevision||previous?.externalRevision||previous?.revision||null});
  let serial=1,queue=[{id:'s1',title:task.title,instruction:task.instruction}],lastBinding=null,lastReceipt=null,lastCheckpoint=null;
  const titles=new Set(),finishedWork=[];
  const titleKey=x=>x.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
  while(queue.length){
   await boundary('worker_wave');await current();const step=queue.shift(),workStepId=task.id+'.'+step.id;
   const parent=previous?.handoffCandidateRevision||previous?.externalRevision||previous?.revision||null,taskDigest=sha256(JSON.stringify(task));
   await emit({phase:'work_started',taskId:task.id,workStepId,title:step.title,instruction:step.instruction,parentCandidateRevision:parent});
   let failed=null,accepted=false;
   for(let attempt=0;attempt<2;attempt++){
    await current();if(calls>=reservedCalls-(pending.size-1)-queue.length)fail('adaptive_work_reservation_exhausted');
    if(attempt){await boundary('worker_wave');await current();await emit({phase:'repairing',taskId:task.id,workStepId,attempt,parentCandidateRevision:parent,failedCandidateRevision:failed.bundle.manifest.revision});}
    const binding=freeze({strategy:'static-react-packages-v1',taskId:task.id,taskDigest,attempt,parentCandidateRevision:parent,failedCandidateRevision:failed?.bundle.manifest.revision||null,diagnosticDigest:failed?sha256(JSON.stringify(failed.receipt.diagnostic)):null,workStepId});
    const slots=reservedCalls-calls-1-(pending.size-1)-queue.length;
    const messages=buildStaticPackageMessages({context:ctx,task,approvedPackages:approved,previousSource:previous,parentCandidateRevision:parent,maxInputBytes,currentWork:{...step,workStepId,remainingWorkSlots:Math.max(0,slots),alreadyScheduled:queue.map(({title,instruction})=>({title,instruction})),completedWork:finishedWork},...(failed?{repair:{candidateRevision:failed.bundle.manifest.revision,diagnostic:failed.receipt.diagnostic,failedSource:view(failed.bundle),instruction:'Repair this exact current work candidate; preserve prior accepted work.'}}:{})});
    calls++;const response=await invokeModel({task,attempt,messages,binding,workStepId});await current();if(response?.usageKnown!==true)fail('package_usage_unknown');
    const parsed=parsePackageResult(response.output),output=parsed.project;if(output?.baseRevision!==ctx.revision)fail('package_base_mismatch');
    const bundle=validateProject(output,{runId:ctx.runId,planRevision:ctx.planRevision,taskIds:ctx.taskIds});
    await emit({phase:'authored',taskId:task.id,workStepId,attempt,parentCandidateRevision:parent,candidateRevision:bundle.manifest.revision,packageBinding:binding});
    await emit({phase:'checking',taskId:task.id,workStepId,attempt,parentCandidateRevision:parent,candidateRevision:bundle.manifest.revision,packageBinding:binding});
    const verificationBinding=freeze({owner:ctx.owner,sessionId:ctx.sessionId,runId:ctx.runId,planRunId:ctx.planRunId,planRevision:ctx.planRevision,baseRevision:ctx.revision,sourceRevision:bundle.manifest.revision});
    const receipt=freeze(validateCandidateVerification(await verifyCandidate({binding:verificationBinding,bundle,assertCurrent:current,signal,workStepId}),verificationBinding,bundle));await current();
    if(bundle.files.reduce((n,f)=>n+f.bytes,0)>100000&&receipt.status==='compiled')fail('package_source_limit');
    const saved=await retainCandidate({context:{...ctx,baseRevision:ctx.revision},bundle,receipt,packageBinding:binding});await current();
    if(saved?.candidateRevision!==bundle.manifest.revision||saved.published!==false||saved.execution!=='not_run'||!/^[a-f0-9]{64}$/.test(saved.recordDigest||''))fail('package_checkpoint_unconfirmed');
    const checkpoint=freeze({candidateRevision:saved.candidateRevision,recordDigest:saved.recordDigest,published:false,execution:'not_run'});receipts.push(freeze({taskId:task.id,workStepId,attempt,packageBinding:binding,receipt,checkpoint}));
    await emit({phase:'work_checked',taskId:task.id,workStepId,attempt,parentCandidateRevision:parent,candidateRevision:bundle.manifest.revision,packageBinding:binding,receipt,checkpoint});
    if(receipt.status!=='compiled'){if(receipt.status==='unsupported')fail('package_profile_unsupported');if(attempt||receipt.diagnostic.code!=='syntax_rejected'||!Number.isSafeInteger(receipt.diagnostic.line))fail('package_verification_failed');failed={bundle,receipt};continue;}
    // A reminder about an already queued item is not a new node or a new call.
    // Keep its first recorded instruction unchanged; never execute it twice.
    const next=newDiscoveredWork(queue,parsed.work?.next||[]);
    if(next.length>slots)fail('adaptive_work_reservation_exhausted');
    for(const item of next){const key=titleKey(item.title);if(titles.has(key))fail('adaptive_work_duplicate');titles.add(key);queue.push({...item,id:'s'+(++serial)});}
    titles.add(titleKey(step.title));titles.add(titleKey(parsed.work?.title||step.title));finishedWork.push({title:parsed.work?.title||step.title});
    const before=new Map((previous?.files||[]).map(f=>[f.path,sha256(f.content)])),changes=bundle.files.filter(f=>before.get(f.path)!==f.sha256).map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes,change:before.has(f.path)?'changed':'created'}));
    previous=freeze(view(bundle));lastOutput=freeze(structuredClone(output));lastBundle=bundle;lastBinding=binding;lastReceipt=receipt;lastCheckpoint=checkpoint;
    await emit({phase:'work_refined',taskId:task.id,workStepId,title:parsed.work?.title||step.title,next:queue.map(w=>({...w,workStepId:task.id+'.'+w.id})),packageBinding:binding,receipt,checkpoint,candidateRevision:bundle.manifest.revision});
    await emit({phase:'work_completed',taskId:task.id,workStepId,title:parsed.work?.title||step.title,summary:changes.length?changes.length+' source file'+(changes.length===1?'':'s')+' changed; compiled. Browser tests not run.':'No source changes; compile check passed. Browser tests not run.',changes,packageBinding:binding,receipt,checkpoint,candidateRevision:bundle.manifest.revision});
    if(parsed.decisionProposals.length)await emit({phase:'work_options',taskId:task.id,workStepId,packageBinding:binding,checkpoint,candidateRevision:bundle.manifest.revision,decisionProposals:parsed.decisionProposals});
    accepted=true;break;
   }
   if(!accepted)fail('package_verification_failed');
  }
  completed.add(task.id);pending.delete(task.id);
  await emit({phase:'compiled',taskId:task.id,candidateRevision:lastBundle.manifest.revision,packageBinding:lastBinding,receipt:lastReceipt,checkpoint:lastCheckpoint});
 }
 await current();return freeze({output:lastOutput,bundle:lastBundle,receipts,modelCalls:calls,completedTaskIds:[...completed],execution:'not_run',tests:'not_run',browser:'unverified',goalCompletion:'not_established',published:false});
}
