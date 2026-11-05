import {createPackageCandidateStore} from './package-candidate-store.mjs';
import {safeAdaptiveWorkFields} from '../web/adaptive-work.js';
// Read the exact retained compiled step snapshot, including after later work.
export async function readWorkStepFile(store,owner,{sessionId,runId,workStepId,path}){
 if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||!/^run_[A-Za-z0-9-]+$/.test(runId||'')||!['src/main.jsx','src/styles.css'].includes(path))throw Error('work_file_unavailable');
 const run=await store.getRun(runId,owner);if(run?.sessionId!==sessionId)throw Error('work_file_unavailable');
 const rows=run.events,done=rows.find(e=>e.type==='work.step.completed'&&e.workStepId===workStepId),start=rows.find(e=>e.type==='project.generating'&&e.adaptiveWorkflow===true),plan=rows.find(e=>e.type==='plan.created'&&e.interactionMode==='agent');
 if(!done||!start||!plan)throw Error('work_file_unavailable');safeAdaptiveWorkFields(done,rows);
 const proof=rows.find(e=>e.type==='validation.completed'&&e.workStepId===workStepId&&e.sourceVerification?.sourceRevision===done.candidateRevision&&e.sourceVerification.status==='compiled');if(!proof)throw Error('work_file_unavailable');
 const context={owner,sessionId,runId,planRunId:start.planRunId,planRevision:start.planRevision,baseRevision:start.baseSourceRevision??null,taskIds:plan.tasks.map(t=>t.id),...(start.sourceBaseAdoption?{sourceBaseAdoption:start.sourceBaseAdoption}:{}),...(start.refinementHandoff?{refinementHandoff:start.refinementHandoff}:{}),...(start.terminalContinuation?{terminalContinuation:start.terminalContinuation}:{})};
 const saved=createPackageCandidateStore(store).read(context,proof.packageBinding,done.candidateRevision);if(saved.recordDigest!==proof.packageCheckpoint.recordDigest)throw Error('work_file_unavailable');const file=saved.candidate.files.find(f=>f.path===path);if(!file)throw Error('work_file_unavailable');return {sessionId,runId,workStepId,revision:done.candidateRevision,path,sha256:file.sha256,content:file.content,scope:'retained_compiled_snapshot',execution:'not_run'};
}
