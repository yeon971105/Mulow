import {storedPlanArtifactFields} from '../web/planning-artifact.js';
import {implementationProfileFields} from '../web/implementation-profile.js';
import {validateProject} from '../backend/project-output/contract.mjs';
import path from 'node:path';
import {existsSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createBundleStore} from '../backend/project-output/store.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const runId=value=>typeof value==='string'&&/^run_[A-Za-z0-9-]+$/.test(value);
// A restored plan may reuse a snapshot only when the local server can prove
// that each restore copied the same complete plan from this owner's session.
function restoredPlanAncestors(store,sessionId,owner){
 const rows=store.db.prepare("SELECT r.id,r.reason,e.payload FROM runs r JOIN events e ON e.run_id=r.id WHERE r.session_id=? AND r.owner=? AND r.status='completed' AND CASE WHEN json_valid(e.payload) THEN json_extract(e.payload,'$.type') END='plan.created' ORDER BY r.rowid DESC LIMIT 500").all(sessionId,owner);
 const plans=new Map(),duplicates=new Set();
 for(const row of rows){if(!runId(row.id))continue;if(plans.has(row.id)){duplicates.add(row.id);continue;}try{const p=JSON.parse(row.payload);if(p.runId===row.id&&p.interactionMode==='plan')plans.set(row.id,{p,reason:row.reason});}catch{}}
 for(const id of duplicates)plans.delete(id);
 const keys=['goal','goalRevision','tasks','architecture','alternatives','clarificationQuestions','needsDesignDraft','sourceRevision','planningContract','planArtifact','planArtifactDigest','planArtifactSeal','planAnswerEvidence','planSourceEvidence','documentPlanningContract','planDocument','documentInterpretationIndex','documentBinding','documentArchitectureStage'];
 // Original plans from older sessions can omit these two provenance fields.
 // Normalize only to the first owned plan, matching canonicalPlan, never to a
 // later proposal or a source from another session.
 const firstRow=store.db.prepare("SELECT r.id,e.payload FROM runs r JOIN events e ON e.run_id=r.id WHERE r.session_id=? AND r.owner=? AND r.status='completed' AND CASE WHEN json_valid(e.payload) THEN json_extract(e.payload,'$.type') END='plan.created' AND CASE WHEN json_valid(e.payload) THEN json_extract(e.payload,'$.interactionMode') END='plan' ORDER BY r.rowid ASC,e.sequence ASC LIMIT 1").get(sessionId,owner);
 let firstGoal,firstId;try{firstGoal=JSON.parse(firstRow?.payload||'null')?.goal;firstId=firstRow?.id;}catch{}
 if(!runId(firstId)||typeof firstGoal!=='string')return new Map();
 const same=(a,b)=>keys.every(k=>JSON.stringify(a[k]??null)===JSON.stringify(b[k]??null))&&(a.originalGoal??firstGoal)===(b.originalGoal??firstGoal)&&(a.originalGoalRunId??firstId)===(b.originalGoalRunId??firstId);
 const result=new Map();
 for(const [id,entry] of plans){if(entry.reason!=='user_restored_plan')continue;let current=id,chain=[],seen=new Set();
  while(true){if(seen.has(current)||seen.size>=50){chain=[];break;}seen.add(current);const item=plans.get(current),from=item?.p?.restoreOf?.sourcePlanRunId;if(!from){if(item?.reason==='user_restored_plan')chain=[];break;}
   const previous=plans.get(from);if(item.reason!=='user_restored_plan'||!runId(from)||!previous||!same(item.p,previous.p)){chain=[];break;}chain.push(from);current=from;
  }
  if(chain.length)result.set(id,chain);
 }
 return result;
}
export function createProjectOutputService(store,{getSourceBaseAdoption=()=>null,getRefinementHandoff=()=>null,sourceContextByteLimit=1000000,assertPackageContinuation=null,assertPlanArtifact=null}={}){
 const parent=path.join(store.directory,'project-bundles');mkdirSync(parent,{recursive:true,mode:0o700});
 store.db.exec('CREATE TABLE IF NOT EXISTS project_bundles(run_id TEXT PRIMARY KEY REFERENCES runs(id), session_id TEXT NOT NULL, owner TEXT NOT NULL, revision TEXT NOT NULL, plan_run_id TEXT NOT NULL, manifest TEXT NOT NULL)');
 store.db.exec('CREATE TABLE IF NOT EXISTS project_source_rollbacks (id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,target_run_id TEXT NOT NULL,target_revision TEXT NOT NULL,current_revision TEXT NOT NULL,current_hash TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,finished TEXT,result TEXT)');
 const binding=(runId,owner,sessionId)=>{const row=store.db.prepare('SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?').get(runId,owner,sessionId);if(!row||row.status!=='running')throw Error('active_owned_run_required');if(!/^[a-f0-9-]{36}$/.test(sessionId))throw Error('invalid_session');return row;};
 const workspace=sessionId=>createBundleStore(path.join(parent,sessionId));
 const ownedBundle=({runId,owner,sessionId,revision})=>{
  if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||!/^run_[A-Za-z0-9-]+$/.test(runId||'')||!/^[a-f0-9]{64}$/.test(revision||''))throw Error('project_not_found');
  const row=store.db.prepare("SELECT p.*,r.rowid AS run_order FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.run_id=? AND p.owner=? AND p.session_id=? AND p.revision=? AND r.owner=p.owner AND r.session_id=p.session_id AND r.status='completed'").get(runId,owner,sessionId,revision);if(!row)throw Error('project_not_found');return row;
 };
 const snapshot=input=>{const row=ownedBundle(input),result=workspace(input.sessionId).readSnapshot(input.revision),record=JSON.parse(row.manifest);if(result.manifest.source.runId!==input.runId||result.manifest.source.planRevision!==record.planRevision)throw Error('project_binding_changed');return Object.freeze({...result,runId:input.runId,sessionId:input.sessionId,planRunId:row.plan_run_id,planRevision:record.planRevision,entrypoints:result.manifest.entrypoints,dependencies:result.manifest.dependencies,verificationIntents:result.manifest.verificationIntents});};
 const rollbackTarget=input=>{const row=ownedBundle(input),target=snapshot(input);if(!target.currentRevision||target.currentRevision===input.revision)throw Error('rollback_already_current');const current=store.db.prepare("SELECT p.run_id,r.rowid AS run_order FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.revision=? AND p.owner=? AND p.session_id=? AND r.owner=p.owner AND r.session_id=p.session_id AND r.status='completed'").get(target.currentRevision,input.owner,input.sessionId);if(!current)throw Error('owned_current_revision_required');return target;};
 const adoptionBinding=sessionId=>{const service=getSourceBaseAdoption();const a=service?.current({sessionId});return a?{adoptionId:a.adoptionId,digest:a.digest,externalRevision:a.externalRevision,sourceDigest:a.sourceDigest,originalSourceDigest:a.originalSourceDigest}:null;};
 const adoptedSource=context=>{
  const current=adoptionBinding(context.sessionId);
  if(JSON.stringify(current)!==JSON.stringify(context.sourceBaseAdoption||null))throw Error('source_adoption_context_changed');
  if(!current)return null;
  return getSourceBaseAdoption().modelSource({sessionId:context.sessionId,adoptionId:current.adoptionId,expectedNativeRevision:context.revision,expectedNativeCurrentHash:context.currentHash,maxContextBytes:sourceContextByteLimit});
 };
 const handoffSource=context=>{const service=getRefinementHandoff(),current=service?.currentBinding(context.sessionId,context.planRunId)||null;if(JSON.stringify(current)!==JSON.stringify(context.refinementHandoff||null))throw Error('handoff_context_changed');return current?service.modelSource({sessionId:context.sessionId,planRunId:context.planRunId,expectedNativeRevision:context.revision,expectedNativeCurrentHash:context.currentHash,maxContextBytes:sourceContextByteLimit}):null;};
 return {
  modelSource(context){
   // Use only owned generated source or an explicitly reviewed adopted base.
   // Never scan unconsented local-only files, arbitrary paths or credentials.
   binding(context.runId,context.owner,context.sessionId);
   const current=workspace(context.sessionId).inspect();
   if(current.revision!==context.revision||current.currentHash!==context.currentHash)throw Error('stale_revision');
   const adopted=adoptedSource(context),handoff=handoffSource(context);if(handoff)return handoff;if(adopted)return adopted;
   if(!context.revision)return null;
   const row=store.db.prepare("SELECT p.run_id FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.owner=? AND p.session_id=? AND p.revision=? AND r.owner=p.owner AND r.session_id=p.session_id AND r.status='completed'").get(context.owner,context.sessionId,context.revision);
   if(!row)throw Error('owned_completed_source_base_required');
   const previous=snapshot({runId:row.run_id,owner:context.owner,sessionId:context.sessionId,revision:context.revision});
   return {revision:previous.revision,entrypoints:previous.entrypoints,dependencies:previous.dependencies,
    files:previous.files.map(({path,content})=>({path,content}))};
  },
  readSnapshot:snapshot,
  currentLineage({sessionId,owner}){
   if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||owner!=='local-musepilot-user')throw Error('invalid_session');
   if(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='linked_restores'").get()&&store.db.prepare("SELECT 1 FROM linked_restores WHERE owner=? AND session_id=? AND status IN ('applying','unconfirmed') LIMIT 1").get(owner,sessionId))return {status:'unconfirmed',reason:'linked_restore_unconfirmed'};
   if(store.db.prepare("SELECT 1 FROM project_source_rollbacks WHERE owner=? AND session_id=? AND status='applying' LIMIT 1").get(owner,sessionId))return {status:'unconfirmed',reason:'restore_unconfirmed'};
   // Do not create an empty workspace merely to inspect it. A pointer is only
   // identified after the matching completed, owned snapshot is verified.
   if(!existsSync(path.join(parent,sessionId)))return {status:'empty'};
   try{
    const current=workspace(sessionId).inspect();if(!current.revision)return {status:'empty'};
    const row=store.db.prepare("SELECT p.run_id,p.plan_run_id FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.revision=? AND p.owner=? AND p.session_id=? AND r.owner=p.owner AND r.session_id=p.session_id AND r.status='completed' ORDER BY r.rowid DESC LIMIT 1").get(current.revision,owner,sessionId);
    if(!row||!runId(row.plan_run_id))return {status:'unconfirmed'};
    const verified=snapshot({runId:row.run_id,owner,sessionId,revision:current.revision});
    if(verified.currentRevision!==current.revision||verified.currentHash!==current.currentHash)return {status:'unconfirmed'};
    return {status:'known',revision:current.revision,runId:row.run_id,planRunId:row.plan_run_id};
   }catch{return {status:'unconfirmed'};}
  },
  listLineage({sessionId,owner}){if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||owner!=='local-musepilot-user')throw Error('invalid_session');const restores=restoredPlanAncestors(store,sessionId,owner);return store.db.prepare("SELECT p.run_id,p.revision,p.plan_run_id,p.manifest FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.session_id=? AND p.owner=? AND r.session_id=p.session_id AND r.owner=p.owner AND r.status='completed' ORDER BY r.rowid DESC LIMIT 200").all(sessionId,owner).reverse().flatMap(row=>{try{const m=JSON.parse(row.manifest);if(!runId(row.plan_run_id)||!/^[a-f0-9]{64}$/.test(row.revision)||!/^[a-f0-9]{64}$/.test(m.planRevision))return [];const restoredPlanRunIds=[...restores].filter(([,ancestors])=>ancestors.includes(row.plan_run_id)).map(([id])=>id).slice(0,200);return [{runId:row.run_id,revision:row.revision,planRunId:row.plan_run_id,planRevision:m.planRevision,...(restoredPlanRunIds.length?{restoredPlanRunIds}:{})}];}catch{return [];}});},
  previewRollback(input){const target=rollbackTarget(input),previewId='rollback_'+randomUUID();store.db.prepare("INSERT INTO project_source_rollbacks(id,owner,session_id,target_run_id,target_revision,current_revision,current_hash,status,created) VALUES(?,?,?,?,?,?,?,'previewed',?)").run(previewId,input.owner,input.sessionId,input.runId,input.revision,target.currentRevision,target.currentHash,new Date().toISOString());return {previewId,targetRunId:input.runId,targetRevision:input.revision,currentRevision:target.currentRevision,currentHash:target.currentHash,execution:'not_run',tests:'not_run'};},
  rollback(input){
   const record=store.db.prepare('SELECT * FROM project_source_rollbacks WHERE id=? AND owner=? AND session_id=?').get(input.previewId,input.owner,input.sessionId);
   if(!record||record.target_run_id!==input.runId||record.target_revision!==input.revision||record.current_hash!==input.expectedCurrentHash||record.current_revision!==input.expectedCurrentRevision)throw Error('rollback_preview_mismatch');
   if(record.status!=='previewed')throw Error('rollback_preview_consumed');
   const target=rollbackTarget(input);if(target.currentHash!==record.current_hash||target.currentRevision!==record.current_revision)throw Error('stale_revision');
   if(store.db.prepare("UPDATE project_source_rollbacks SET status='applying' WHERE id=? AND status='previewed'").run(record.id).changes!==1)throw Error('rollback_preview_consumed');
   let switched=false;
   try{const result=workspace(input.sessionId).rollback(input.revision,{expectedCurrentHash:input.expectedCurrentHash,expectedCurrentRevision:input.expectedCurrentRevision});switched=true;if(store.db.prepare("UPDATE project_source_rollbacks SET status='completed',finished=?,result=? WHERE id=? AND status='applying'").run(new Date().toISOString(),JSON.stringify(result),record.id).changes!==1)throw Error('rollback_audit_not_completed');return {...result,previewId:record.id,targetRunId:input.runId};}
   catch(error){if(switched||error.pointerChanged){const uncertain=Error('rollback_outcome_unconfirmed');uncertain.cause=error;throw uncertain;}try{store.db.prepare("UPDATE project_source_rollbacks SET status='failed',finished=?,result=? WHERE id=? AND status='applying'").run(new Date().toISOString(),JSON.stringify({reason:error.message}),record.id);}catch{}throw error;}
  },
  rollbackStatus({previewId,owner,sessionId}){const row=store.db.prepare('SELECT * FROM project_source_rollbacks WHERE id=? AND owner=? AND session_id=?').get(previewId,owner,sessionId);if(!row)throw Error('rollback_not_found');return {previewId,status:row.status,targetRevision:row.target_revision,previousRevision:row.current_revision,observedCurrent:workspace(sessionId).inspect(),execution:'not_run'};},
  inspect({sessionId}){if(!/^[a-f0-9-]{36}$/.test(sessionId||''))throw Error('invalid_session');const w=workspace(sessionId),state=w.inspect();if(state.revision)w.exportZip(state.revision);return state;},
  prepare({runId,owner,sessionId,planRunId,planChoice,tasks,architecture,goal,sourceRevision,requiredCapabilities,implementationProfile,...artifactMetadata}){binding(runId,owner,sessionId);const state=workspace(sessionId).inspect(),sourceBaseAdoption=adoptionBinding(sessionId),refinementHandoff=getRefinementHandoff()?.currentBinding(sessionId,planRunId)||null;if(sourceBaseAdoption)adoptedSource({...state,sessionId,sourceBaseAdoption});if(refinementHandoff)handoffSource({...state,sessionId,planRunId,refinementHandoff});const artifactFields=storedPlanArtifactFields(artifactMetadata,{...artifactMetadata,tasks,architecture,requiredCapabilities});return Object.freeze({...state,...artifactFields,...(refinementHandoff?{refinementHandoff:Object.freeze(refinementHandoff)}:{}),...(sourceBaseAdoption?{sourceBaseAdoption:Object.freeze(sourceBaseAdoption)}:{}),runId,owner,sessionId,planRunId,planChoice:planChoice||null,planRevision:digest({planRunId,planChoice:planChoice||null,tasks,architecture,goal,sourceRevision:sourceRevision||null,...(requiredCapabilities===undefined?{}:{requiredCapabilities}),...implementationProfileFields(implementationProfile===undefined?{}:{implementationProfile}),...artifactFields}),taskIds:tasks.map(t=>t.id)});},
  publish(context,proposal,signal){
   let published=false;store.db.exec('BEGIN IMMEDIATE');try{
   if(signal.aborted)throw Error('run_cancelled');if(context.planArtifact||context.planningContract){const valid=assertPlanArtifact?.(context);if(!valid||typeof valid.then==='function')throw Error('plan_artifact_approval_changed');}binding(context.runId,context.owner,context.sessionId);
   if(context.terminalContinuation){const authority=typeof assertPackageContinuation==='function'?assertPackageContinuation(context):null;if(!authority||typeof authority.then==='function'||authority.runId!==context.planRunId)throw Error('package_continuation_authority_required');}else if(!store.db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(context.planRunId,context.sessionId))throw Error('approved_plan_required');
   if(context.planChoice&&!store.db.prepare('SELECT 1 FROM plan_choices WHERE run_id=? AND session_id=? AND choice_id=?').get(context.planRunId,context.sessionId,context.planChoice))throw Error('approved_choice_required');
   adoptedSource(context);handoffSource(context);
   if(proposal.baseRevision!==context.revision)throw Error('stale_revision');
   const checked=validateProject(proposal,{runId:context.runId,planRevision:context.planRevision,taskIds:context.taskIds});
   const summary={...(context.terminalContinuation?{terminalContinuation:context.terminalContinuation}:{}),...(context.refinementHandoff?{refinementHandoff:context.refinementHandoff}:{}),...(context.sourceBaseAdoption?{sourceBaseAdoption:context.sourceBaseAdoption}:{}),revision:checked.manifest.revision,status:'generated_unverified',execution:'not_run',tests:'not_run',fileCount:checked.files.length,files:checked.files.map(f=>f.path),entrypoints:proposal.entrypoints,dependencies:proposal.dependencies,verificationIntents:proposal.verificationIntents.map(v=>({...v,status:'not_run'})),planRunId:context.planRunId,planRevision:context.planRevision};
   // Record ownership before filesystem publication. Export additionally requires a
   // completed run, so an interrupted/failed publication record is never downloadable.
   // A database insert failure cannot advance the filesystem pointer.
   store.db.prepare('INSERT INTO project_bundles VALUES(?,?,?,?,?,?)').run(context.runId,context.sessionId,context.owner,summary.revision,context.planRunId,JSON.stringify(summary));
   workspace(context.sessionId).publish(proposal,{runId:context.runId,planRevision:context.planRevision,taskIds:context.taskIds},{expectedCurrentHash:context.currentHash});published=true;
   if(context.sourceBaseAdoption)getSourceBaseAdoption().releaseAfterPublication({sessionId:context.sessionId,...context.sourceBaseAdoption});
   if(context.refinementHandoff)getRefinementHandoff().releaseAfterPublication({sessionId:context.sessionId,planRunId:context.planRunId});
   store.db.exec('COMMIT');return summary;
   }catch(error){try{store.db.exec('ROLLBACK');}catch{}if(published||error.pointerChanged){const uncertain=Error('project_publication_unconfirmed');uncertain.pointerChanged=true;uncertain.cause=error;throw uncertain;}throw error;}
  },
  exportZip({runId,owner,sessionId,revision}){
   if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||!/^run_[A-Za-z0-9-]+$/.test(runId||'')||!/^[a-f0-9]{64}$/.test(revision||''))throw Error('project_not_found');
   const row=store.db.prepare("SELECT p.* FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.run_id=? AND p.owner=? AND p.session_id=? AND p.revision=? AND r.status='completed'").get(runId,owner,sessionId,revision);
   if(!row)throw Error('project_not_found');return workspace(sessionId).exportZip(revision);
  }
 };
}
