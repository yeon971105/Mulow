// Public operational evidence only: never model reasoning, raw responses or fabricated updates.
import {failureInfo,safeProgressText} from './live.js';
export const WORK_PHASES=['candidate_validation_started','candidate_validation_passed','snapshot_save_started','snapshot_save_completed'];
export {safeJournalPath} from './live.js';
const stamp=e=>{const n=Date.parse(e?.at||e?.time||'');return Number.isFinite(n)?n:null;};
export function workJournal(events,{tasks=[],artifacts=[]}={}){
 const names=new Map(tasks.map(t=>[t.id,t.title||t.text||'requested task'])),rows=[],seen=new Set();
 for(const [i,e] of events.entries()){
  const id=e.id||`${e.runId||'history'}:${e.sequence||i}:${e.type}`;if(seen.has(id))continue;seen.add(id);let text='';
  const name=names.get(e.taskId)||'requested task';
  if(e.type==='run.started')text='Started this requested operation.';
  if(e.type==='context.prepared')text='Prepared the submitted scope and available prerequisite context.'+(Number.isInteger(e.truncatedArtifacts)&&e.truncatedArtifacts>0?' '+e.truncatedArtifacts+' prerequisite excerpt(s) were truncated; omitted content was not reviewed.':'');
  if(e.type==='task.started')text='Started authoring '+name+'.';
  if(e.type==='tool.started'&&e.name==='model.chat.completions')text=e.agentId?.endsWith(':project-author')?'Generating project source. Waiting for the model response.':e.agentId?.endsWith(':briefing')?'Answering your question; waiting for the model response.':e.taskId?'Requested outputs for '+name+'; waiting for the model response.':'Preparing the blueprint; waiting for the model response.';
  if(e.type==='tool.started'&&e.name==='artifact.validate')text='Checking artifact schema, safe paths and content size.';
  if(e.type==='tool.completed'&&e.name==='artifact.validate')text='Artifact schema, path and size checks passed; code was not executed.';
  if(e.type==='tool.started'&&e.name==='artifact.save')text='Saving validated artifacts in the run workspace.';
  if(e.type==='tool.started'&&e.name==='source.verify')text='Compiling the current source candidate locally.';
  if(e.type==='tool.completed'&&e.name==='source.verify')text='Source compilation finished. Browser behavior is not verified by this operation.';
  if(e.type==='package.progress')text=({authored:'Source candidate received.',checking:'Checking and compiling this source package.',repairing:'Repairing the source rejected by the recorded static check.'})[e.phase]||'';
  if(e.type==='tool.completed'&&e.name==='artifact.save')text='Artifact persistence completed.';
  if(e.type?.startsWith('steering.'))text=({requested:'Steering requested.',waiting:'Finishing active work before steering.',ready:'Steering priority ready; prerequisites stay in order.',running:'Steered work started.'})[e.type.slice(9)]||'';
  if(e.type==='model.response')text='Model response received; acceptance checks determine what can be saved.'+(e.responseEnvelope==='fenced_json'?' A standalone JSON fence was removed before validation.':'');
  if(e.type==='tool.completed'&&e.name==='plan.validate')text='Plan structure and dependencies checked.';
  if(e.type==='work.progress')text=({candidate_validation_started:'Checking the generated candidate against the required schema.',candidate_validation_passed:'Candidate validation passed; this is not an execution test.',snapshot_save_started:'Preparing to save the validated candidate; checking the current revision.',snapshot_save_completed:'Source snapshot saved.'})[e.phase]||'';
  if(e.type==='artifacts.created'){const files=artifacts.filter(a=>a.taskId===e.taskId);text=files.length?'Saved '+files.map(a=>a.name).join(', ')+'.':'Generated artifact records saved.';}
  if(e.type==='validation.completed')text=e.sourceVerification?.status==='compiled'?'Source compilation passed. Browser behavior remains unverified.':e.sourceVerification?.status==='failed'?'Static source verification failed. No browser test passed.':'Recorded checks: '+((e.checks||[]).join(', ')||'artifact validation')+'. Code execution and tests are separate.';
  if(e.type==='expansion.rejected')text='Additional work proposal rejected; the approved plan was not changed and no proposed task ran.';
  if(e.type==='expansion.proposed')text='Additional work proposed for review; it is not approved or run.';
  if(e.type==='architecture.created')text='Structured design checked and saved.';
  if(e.type==='project.generated')text='Saved project source'+(Number.isInteger(e.fileCount)?' · '+e.fileCount+' file'+(e.fileCount===1?'':'s'):'')+'.';
  if(e.type==='task.completed')text=e.meaning==='source_package_compiled'?'Compiled source package for '+name+'. Browser tests remain unverified.':'Authored outputs for '+name+'; this does not mean the generated application was executed.';
  if(['run.failed','task.failed','tool.failed'].includes(e.type))text=failureInfo(e.code||e.summary,e.details).reason||'This operation failed; the precise cause is not recorded.';
  if(e.type==='run.cancelled')text='Operation stopped. Previously saved evidence is retained.';
  if(e.type==='run.completed')text=({project_files_generated:'Source generation finished.',model_artifacts_authored:'Task outputs authored; generated code was not executed.',continuation_artifacts_authored:'Remaining task outputs authored; generated code was not executed.',architecture_recovery_authored:'Validated repair saved; downstream work requires separate approval.',plan_needs_clarification:'Your answers are needed before the blueprint can be finalized.',plan_needs_design:'Required design is not ready; review the recorded issue.',plan_ready_for_approval:'Blueprint prepared for review; implementation has not started.',read_only_answer:'Read-only answer recorded; no files changed.'})[e.meaning||e.summary]||'Operation ended; inspect saved outputs and recorded checks below.';
  if(text){text=safeProgressText(text,1600);const prior=rows.at(-1);if(prior?.text===text&&prior.taskId===e.taskId&&prior.runId===e.runId)continue;rows.push({id,text,at:stamp(e),taskId:e.taskId,runId:e.runId});}
 }
 return rows;
}
export function journalEvents(events,group){
 if(!group)return events;
 if(group.projectGeneration||group.projectRepair){const runs=new Set((group.tasks||[]).map(t=>t.runId).filter(Boolean));return events.filter(e=>runs.has(e.runId));}
 const ids=new Set(group.taskIds||[]);
 return events.filter(e=>typeof e.taskId==='string'&&ids.has(e.taskId));
}
// One meaningful last update per task; do not replay every transport/compiler phase.
export function compactWorkJournal(events,options={}){
 const last=new Map();for(const row of workJournal(events,options)){const key=row.runId+':'+(row.taskId||'run');last.delete(key);last.set(key,row);}return [...last.values()].slice(-24);
}
export function renderWorkJournal(s,view,group,events,artifacts,esc){const rows=workJournal(journalEvents(events,group),{tasks:s.workflow?.tasks||[],artifacts}),key=`${s.id}:${view.runId}:${group?.id||'goal'}`;return '<section class="detail-section work-journal"><h3>Work journal</h3><div class="work-journal-scroll" tabindex="0" aria-label="Recorded work journal" data-journal-key="'+esc(key)+'"><ol class="work-updates" role="log" aria-live="polite" aria-relevant="additions" aria-atomic="false">'+(rows.length?rows.map(r=>'<li data-journal-event="'+esc(r.id)+'"><time>'+esc(r.at===null?'Time unavailable':new Date(r.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}))+'</time><span>'+esc(r.text)+'</span></li>').join(''):'<li>'+(group?'This task has not reported work yet.':'No recorded update yet.')+'</li>')+'</ol></div><button data-action="journal-latest">Latest update ↓</button></section>';}
export function renderWorkReport(events,artifacts,esc,group=null,suppressFailure=false,tasks=[]){
 const ownIds=new Set(group?.taskIds||[]),ownTerminal=group&&!group.projectRepair?events.findLast(e=>ownIds.has(e.taskId)&&['task.completed','task.failed'].includes(e.type)):null;
 if(group&&!group.projectRepair&&!group.projectGeneration&&!ownTerminal)return '';
 const terminal=ownTerminal||events.findLast(e=>['run.completed','run.failed','run.cancelled'].includes(e.type));if(!terminal)return '';
 const scoped=events.filter(e=>e.runId===terminal.runId),taskScoped=ownTerminal?scoped.filter(e=>e.taskId===terminal.taskId):scoped;
 const start=taskScoped.find(e=>e.type===(ownTerminal?'task.started':'run.started')),a=stamp(start),b=stamp(terminal),seconds=a!==null&&b!==null&&b>=a?Math.round((b-a)/1000):null;
 const saved=!ownTerminal&&scoped.some(e=>e.type==='project.generated'),failed=['run.failed','task.failed'].includes(terminal.type),problem=failureInfo(terminal.code||terminal.summary,terminal.details);
 const checks=[...new Set(taskScoped.flatMap(e=>e.type==='validation.completed'?e.checks||[]:e.type==='work.progress'&&e.phase==='candidate_validation_passed'?['candidate schema']:[]))];
 const authored=tasks.filter(t=>taskScoped.some(e=>e.type==='task.completed'&&e.taskId===t.id)).map(t=>t.title||t.text).filter(Boolean);
 const files=artifacts.filter(a=>ownTerminal?a.taskId===terminal.taskId:(a.runId===terminal.runId||a.taskId?.startsWith(terminal.runId+':')));
 const containingFailure=ownTerminal&&scoped.findLast(e=>['run.failed','run.cancelled'].includes(e.type));
 const meaning=terminal.meaning||terminal.summary||'';
 if(!ownTerminal&&terminal.type==='run.completed'&&(/^(plan_|read_only_answer)/.test(meaning)))return '';
 const generated=scoped.findLast(e=>e.type==='project.generated'),fileCount=saved&&Number.isInteger(generated?.fileCount)?generated.fileCount:files.length;
 const duration=seconds===null?'Duration unavailable':Math.floor(seconds/60)+'m '+seconds%60+'s';
 return '<section class="detail-section work-terminal-report"><h3>'+esc(failed?'Stopped':terminal.type==='run.cancelled'?'Stopped':saved?'Project source saved':ownTerminal?'Task outputs saved':'Result')+'</h3><p class="work-result-meta">'+esc(duration+(fileCount?' · '+fileCount+' file'+(fileCount===1?'':'s'):''))+'</p>'+
 (failed&&!suppressFailure?'<p>'+esc(problem.reason||'Failure cause unavailable.')+'</p><p>'+esc(problem.next||'Review the error before trying again.')+'</p>':'')+
 (containingFailure&&!failed?'<small>The containing run later stopped; this task’s saved result remains.</small>':'')+
 (authored.length?'<details><summary>Authored work · '+authored.length+'</summary><p>'+esc(authored.join('; '))+'</p></details>':'')+
 (checks.length?'<small>'+esc('Checked: '+checks.join(', ')+'.')+'</small>':'')+
 ((saved||files.length||authored.length)?'<small>'+(ownTerminal&&group?.projectDraft?'This draft was not executed or tested during its authoring step.':saved?'This source-generation step did not build or test the project.':'Build and test evidence for these outputs is not recorded here.')+'</small>':'')+'</section>';
}
/** A public phase is shown only for an observed active operation, never a timer-generated claim. */
export function activeWorkPhase(events,running){
 if(!running||events.some(e=>['run.completed','run.failed','run.cancelled','task.failed','task.completed','tool.failed'].includes(e.type)))return '';
 const e=events.findLast(e=>['tool.started','tool.completed','model.response','work.progress','run.started'].includes(e.type));
 if(!e)return '';
 if(e.type==='work.progress')return ({candidate_validation_started:'Checking source format',candidate_validation_passed:'Source format checked',snapshot_save_started:'Preparing to save',snapshot_save_completed:'Source saved · finalizing'})[e.phase]||'';
 if(e.type==='model.response')return 'Response received · checking';
 if(e.type==='tool.started')return e.name==='model.chat.completions'?'Waiting for model response':e.name==='artifact.save'?'Saving files':e.name==='artifact.validate'||e.name==='plan.validate'?'Checking output':'Processing recorded operation';
 return e.type==='run.started'?'Preparing request':'Finishing recorded operation';
}
