import {MAX_RUN_MODEL_CALLS,isWorkflowTaskId} from '../web/workflow-limits.js';
import {createCheckpoints} from './checkpoints.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,chmodSync,existsSync,lstatSync,rmSync} from 'node:fs';
import path from 'node:path';
const nano=v=>Math.ceil(v*1e9);
const budgetNano=v=>Math.floor(v*1e9);
// The approved testing ceiling covers every model in this local ledger, including
// historical charges and reservations. This ledger cannot account for other devices.
const CAMPAIGN_LIMIT_NANO=100000000000;
const EXTRA_TEST_APPROVAL='musepilot-additional-test-25-20261028';
const validBudget=v=>Number.isFinite(v)&&v>0&&Number.isSafeInteger(budgetNano(v))&&budgetNano(v)>0;
export function createLocalStore(directory,{budgetUsd=5,additionalTestAllowance=false,providerModel=null,providerBudgetUsd=null}={}){
 if(!validBudget(budgetUsd))throw Error('Invalid approved limits');
 if(providerModel!==null&&(providerModel!=='meta-models/muse-spark-open-1026'||!validBudget(providerBudgetUsd)||providerBudgetUsd>100))throw Error('Invalid provider allowance');
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const db=new DatabaseSync(path.join(directory,'musepilot.sqlite'));chmodSync(path.join(directory,'musepilot.sqlite'),0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY CHECK(id=1),limit_nano INTEGER NOT NULL CHECK(limit_nano>0 AND limit_nano<=9007199254740991),enabled INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,operation TEXT UNIQUE,session_id TEXT NOT NULL,owner TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,reserved INTEGER NOT NULL,charged INTEGER NOT NULL DEFAULT 0,started_calls INTEGER NOT NULL DEFAULT 0,usage_known INTEGER NOT NULL DEFAULT 0,reason TEXT,created TEXT NOT NULL,finished TEXT);
 CREATE TABLE IF NOT EXISTS operation_closures (operation TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,closed_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS events(run_id TEXT REFERENCES runs(id),sequence INTEGER,payload TEXT NOT NULL,PRIMARY KEY(run_id,sequence));
 CREATE TABLE IF NOT EXISTS artifacts(run_id TEXT REFERENCES runs(id),task_id TEXT,idx INTEGER,payload TEXT NOT NULL,PRIMARY KEY(run_id,task_id,idx));`);
 // Preserve the historical USD 5 authority, then apply the separately approved one-time allowance. Never reset runs,
 // charges, reservations, disabled state, events or artifacts. Keep the initial authority row.
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE IF NOT EXISTS budget_authorizations (approval_id TEXT PRIMARY KEY,previous_limit_nano INTEGER,approved_limit_nano INTEGER NOT NULL,applied_at TEXT NOT NULL)');
  const definition=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='budget'").get().sql;
  const previous=db.prepare('SELECT * FROM budget WHERE id=1').get();
  if(/limit_nano<=1000000000/.test(definition)){
   db.exec('ALTER TABLE budget RENAME TO budget_initial_authority; CREATE TABLE budget (id INTEGER PRIMARY KEY CHECK(id=1),limit_nano INTEGER NOT NULL CHECK(limit_nano>0 AND limit_nano<=9007199254740991),enabled INTEGER NOT NULL)');
   if(previous)db.prepare('INSERT INTO budget VALUES(1,?,?)').run(Math.min(previous.limit_nano===1000000000?5000000000:previous.limit_nano,budgetNano(budgetUsd)),previous.enabled);
  }
  db.prepare('INSERT OR IGNORE INTO budget VALUES(1,?,1)').run(budgetNano(budgetUsd));
  db.prepare('INSERT OR IGNORE INTO budget_authorizations VALUES(?,?,?,?)').run('Sentinel_237328bb8c388191b1454290037046af',previous?.limit_nano??null,5000000000,new Date().toISOString());
  // Subsequent opens may lower authority; they cannot replenish used/reserved funds.
  const existingGrant=db.prepare('SELECT 1 FROM budget_authorizations WHERE approval_id=?').get(EXTRA_TEST_APPROVAL);
  if(!existingGrant)db.prepare('UPDATE budget SET limit_nano=MIN(limit_nano,?) WHERE id=1').run(budgetNano(budgetUsd));
  if(additionalTestAllowance&&!existingGrant){
   const before=db.prepare('SELECT * FROM budget WHERE id=1').get(),totals=db.prepare('SELECT COALESCE(SUM(charged),0) AS charged,COALESCE(SUM(reserved),0) AS reserved FROM runs WHERE model!=\'meta-models/muse-spark-open-1026\'').get();
   const ceiling=totals.charged+25000000000;if(!Number.isSafeInteger(ceiling))throw Error('Invalid cumulative accounting range');
   // User-authorized extra testing allowance, not an instruction to spend it.
   // BEGIN IMMEDIATE serializes this snapshot with reservation/settlement.
   db.exec('ALTER TABLE budget RENAME TO budget_before_additional_test_allowance; CREATE TABLE budget (id INTEGER PRIMARY KEY CHECK(id=1),limit_nano INTEGER NOT NULL CHECK(limit_nano>0 AND limit_nano<=9007199254740991),enabled INTEGER NOT NULL)');
   db.prepare('INSERT INTO budget VALUES(1,?,?)').run(ceiling,before.enabled);
   db.prepare('INSERT INTO budget_authorizations VALUES(?,?,?,?)').run(EXTRA_TEST_APPROVAL,before.limit_nano,ceiling,new Date().toISOString());
   db.exec('CREATE TABLE IF NOT EXISTS additional_test_allowances (approval_id TEXT PRIMARY KEY,baseline_charged_nano INTEGER NOT NULL,baseline_reserved_nano INTEGER NOT NULL,additional_nano INTEGER NOT NULL)');
   db.prepare('INSERT INTO additional_test_allowances VALUES(?,?,?,?)').run(EXTRA_TEST_APPROVAL,totals.charged,totals.reserved,25000000000);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');db.close();throw error;}
 if(providerModel){
  // A spending ceiling must never round above the user's decimal allocation.
  // Reservation amounts continue to round upward in nano().
  const providerLimitNano=budgetNano(providerBudgetUsd);
  if(!Number.isSafeInteger(providerLimitNano)||providerLimitNano<=0)throw Error('Invalid provider allowance');
  db.exec('CREATE TABLE IF NOT EXISTS provider_budgets (model TEXT PRIMARY KEY,limit_nano INTEGER NOT NULL,enabled INTEGER NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO provider_budgets VALUES(?,?,1)').run(providerModel,providerLimitNano);
  db.prepare('UPDATE provider_budgets SET limit_nano=MIN(limit_nano,?) WHERE model=?').run(providerLimitNano,providerModel);
 }
 const ownerRun=(id,owner)=>db.prepare('SELECT * FROM runs WHERE id=? AND owner=?').get(id,owner);
 let localPlanSourceHooks=null,documentPlanHooks=null,nativePlanSourceHooks=null,buildStartValidator=null,refinementReservationHooks=null,packageContinuationHooks=null;
 const reserveRaw=function({runId,operationId,owner,reservationUsd,budgetUsd,model,sessionId='unbound'}){
  const amount=nano(reservationUsd);if(!Number.isSafeInteger(amount)||amount<=0||!validBudget(budgetUsd))throw Error('Invalid reservation');
  if(providerModel){
   if(model!==providerModel)return {accepted:false,reason:'provider_model_mismatch'};
   const result=db.prepare(`INSERT INTO runs(id,operation,session_id,owner,model,status,reserved,created)
    SELECT ?,?,?,?,?,'running',?,? FROM provider_budgets b WHERE b.model=? AND b.enabled=1
    AND (SELECT enabled FROM budget WHERE id=1)=1
    AND ? <= MIN(b.limit_nano,?,?)-COALESCE((SELECT SUM(reserved+charged) FROM runs),0)
    AND NOT EXISTS(SELECT 1 FROM runs WHERE status='running')
    AND NOT EXISTS(SELECT 1 FROM operation_closures WHERE operation=?) ON CONFLICT(operation) DO NOTHING`).run(runId,operationId,sessionId,owner,model,amount,new Date().toISOString(),providerModel,amount,budgetNano(budgetUsd),CAMPAIGN_LIMIT_NANO,operationId);
   return {accepted:result.changes===1,reason:'provider_budget_or_active_run_limit'};
  }
  const result=db.prepare(`INSERT INTO runs(id,operation,session_id,owner,model,status,reserved,created)
   SELECT ?,?,?,?,?,'running',?,? FROM budget b WHERE b.id=1 AND enabled=1
   AND ? <= MIN(limit_nano,?)-COALESCE((SELECT SUM(reserved+charged) FROM runs WHERE model!='meta-models/muse-spark-open-1026'),0)
   AND ? <= ?-COALESCE((SELECT SUM(reserved+charged) FROM runs),0)
   AND NOT EXISTS(SELECT 1 FROM runs WHERE status='running')
    AND NOT EXISTS(SELECT 1 FROM operation_closures WHERE operation=?)
   ON CONFLICT(operation) DO NOTHING`).run(runId,operationId,sessionId,owner,model,amount,new Date().toISOString(),amount,budgetNano(budgetUsd),amount,CAMPAIGN_LIMIT_NANO,operationId);
  return {accepted:result.changes===1,reason:'budget_or_active_run_limit'};
 };
 return {durable:true,atomicReservation:true,db,directory,
 setPackageContinuationHooks(hooks){if(typeof hooks?.validateReservation!=='function'||typeof hooks?.consumeReservation!=='function')throw Error('Invalid package continuation hooks');packageContinuationHooks=hooks;},
 setBuildStartValidator(fn){if(typeof fn!=='function')throw Error('Invalid Build Start validator');buildStartValidator=fn;},
 setDocumentPlanHooks(hooks){if(typeof hooks?.validateReservation!=='function'||typeof hooks?.consumeReservation!=='function')throw Error('Invalid document Plan hooks');documentPlanHooks=hooks;},
 setLocalPlanSourceHooks(hooks){if(typeof hooks?.validateReservation!=='function'||typeof hooks?.consumeReservation!=='function')throw Error('Invalid local Plan source hooks');localPlanSourceHooks=hooks;},
 setNativePlanSourceHooks(hooks){if(typeof hooks?.validateReservation!=='function'||typeof hooks?.consumeReservation!=='function')throw Error('Invalid native Plan source hooks');nativePlanSourceHooks=hooks;},
 setRefinementReservationHooks(hooks){if(typeof hooks?.validateReservation!=='function'||typeof hooks?.consumeReservation!=='function')throw Error('Invalid refinement reservation hooks');refinementReservationHooks=hooks;},
 reserve(input){
  if(input.localPlanSourceReviewId===undefined&&input.localPlanSourceBinding===undefined&&input.localPlanSourceRequestDigest===undefined&&input.localPlanSourceInputRevision===undefined&&input.localPlanSourceMaxModelCalls===undefined&&input.localPlanSourcePerCallReservationUsd===undefined&&input.documentPlanReceiptId===undefined&&input.documentPlanBinding===undefined&&input.documentPlanMaxModelCalls===undefined&&input.documentPlanPerCallReservationUsd===undefined&&input.nativePlanSourceReviewId===undefined&&input.nativePlanSourceBinding===undefined&&input.nativePlanSourceRequestDigest===undefined&&input.nativePlanSourceInputRevision===undefined&&input.nativePlanSourceMaxModelCalls===undefined&&input.nativePlanSourcePerCallReservationUsd===undefined&&input.packageContinuationApprovalId===undefined&&input.packageContinuationBinding===undefined&&input.buildStartReceiptId===undefined&&input.revokeBuildStartPlanRunId===undefined&&input.refinementHandoffId===undefined&&input.refinementHandoffBinding===undefined)return reserveRaw(input);
  db.exec('BEGIN IMMEDIATE');try{
   const reject=reason=>{db.exec('ROLLBACK');return {accepted:false,reason};};
   let row=null,handoff=null,continuation=null,nativePlanSource=null,documentPlan=null,localPlanSource=null;
   if(input.localPlanSourceReviewId!==undefined||input.localPlanSourceBinding!==undefined||input.localPlanSourceRequestDigest!==undefined||input.localPlanSourceInputRevision!==undefined||input.localPlanSourceMaxModelCalls!==undefined||input.localPlanSourcePerCallReservationUsd!==undefined){
    if(input.documentPlanReceiptId!==undefined||input.nativePlanSourceReviewId!==undefined||input.packageContinuationApprovalId!==undefined||input.buildStartReceiptId!==undefined||input.refinementHandoffId!==undefined)return reject('local_plan_source_authority_conflict');
    localPlanSource=Object.freeze({reviewId:input.localPlanSourceReviewId,binding:input.localPlanSourceBinding,requestDigest:input.localPlanSourceRequestDigest,planningInputRevision:input.localPlanSourceInputRevision,maxModelCalls:input.localPlanSourceMaxModelCalls,perCallReservationUsd:input.localPlanSourcePerCallReservationUsd,reservationUsd:input.reservationUsd,owner:input.owner,sessionId:input.sessionId,model:input.model,operationId:input.operationId,runId:input.runId});
    if(localPlanSourceHooks?.validateReservation(localPlanSource)!==true)return reject('local_plan_source_stale');
   }
   if(input.documentPlanReceiptId!==undefined||input.documentPlanBinding!==undefined||input.documentPlanMaxModelCalls!==undefined||input.documentPlanPerCallReservationUsd!==undefined){
    if(input.nativePlanSourceReviewId!==undefined||input.packageContinuationApprovalId!==undefined||input.buildStartReceiptId!==undefined||input.refinementHandoffId!==undefined)return reject('document_plan_authority_conflict');
    documentPlan={receiptId:input.documentPlanReceiptId,binding:input.documentPlanBinding,maxModelCalls:input.documentPlanMaxModelCalls,perCallReservationUsd:input.documentPlanPerCallReservationUsd,reservationUsd:input.reservationUsd,owner:input.owner,sessionId:input.sessionId,model:input.model,operationId:input.operationId,runId:input.runId};
    if(documentPlanHooks?.validateReservation(documentPlan)!==true)return reject('document_plan_stale');
   }
   if(input.nativePlanSourceReviewId!==undefined||input.nativePlanSourceBinding!==undefined||input.nativePlanSourceRequestDigest!==undefined||input.nativePlanSourceInputRevision!==undefined||input.nativePlanSourceMaxModelCalls!==undefined||input.nativePlanSourcePerCallReservationUsd!==undefined){
    if(input.packageContinuationApprovalId!==undefined||input.buildStartReceiptId!==undefined||input.refinementHandoffId!==undefined)return reject('native_plan_source_authority_conflict');
    nativePlanSource=Object.freeze({reviewId:input.nativePlanSourceReviewId,binding:input.nativePlanSourceBinding,requestDigest:input.nativePlanSourceRequestDigest,planningInputRevision:input.nativePlanSourceInputRevision,maxModelCalls:input.nativePlanSourceMaxModelCalls,perCallReservationUsd:input.nativePlanSourcePerCallReservationUsd,reservationUsd:input.reservationUsd,owner:input.owner,sessionId:input.sessionId,model:input.model,operationId:input.operationId,runId:input.runId});
    let valid=false;try{const value=nativePlanSourceHooks?.validateReservation(nativePlanSource);if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});valid=value===true;}catch{}if(!valid)return reject('native_plan_source_stale');
   }
   if(input.packageContinuationApprovalId!==undefined||input.packageContinuationBinding!==undefined){
    if(input.buildStartReceiptId!==undefined||input.refinementHandoffId!==undefined)return reject('package_continuation_authority_conflict');
    continuation={approvalId:input.packageContinuationApprovalId,binding:input.packageContinuationBinding,owner:input.owner,sessionId:input.sessionId,model:input.model,reservationUsd:input.reservationUsd,operationId:input.operationId,runId:input.runId};
    if(packageContinuationHooks?.validateReservation(continuation)!==true)return reject('package_continuation_stale');
   }
   if(input.refinementHandoffId!==undefined||input.refinementHandoffBinding!==undefined){
    if(typeof input.refinementHandoffId!=='string'||!input.refinementHandoffId||input.refinementHandoffId.length>120||typeof input.refinementHandoffBinding!=='string'||!/^[a-f0-9]{64}$/.test(input.refinementHandoffBinding))return reject('refinement_handoff_invalid');
    handoff=Object.freeze({handoffId:input.refinementHandoffId,binding:input.refinementHandoffBinding,owner:input.owner,sessionId:input.sessionId,model:input.model,operationId:input.operationId,runId:input.runId});
    let valid=false;try{const value=refinementReservationHooks?.validateReservation(handoff);if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});valid=value===true;}catch{}
    if(!valid)return reject('refinement_handoff_stale');
   }
   if(input.revokeBuildStartPlanRunId!==undefined&&(typeof input.revokeBuildStartPlanRunId!=='string'||!input.revokeBuildStartPlanRunId))return reject('build_start_invalidation_invalid');
   if(input.buildStartReceiptId!==undefined){
   if(typeof input.buildStartReceiptId!=='string'||!input.buildStartReceiptId||typeof input.buildStartBinding!=='string'||!/^[a-f0-9]{64}$/.test(input.buildStartBinding))return reject('build_start_invalid');
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='build_start_receipts'").get())return reject('build_start_invalid');
   row=db.prepare('SELECT * FROM build_start_receipts WHERE id=?').get(input.buildStartReceiptId);
   if(!row||row.owner!==input.owner||row.session_id!==input.sessionId||row.binding!==input.buildStartBinding||row.operation_id!==null||row.run_id!==null||!Number.isSafeInteger(row.expires)||row.expires<=Date.now())return reject('build_start_invalid');
   let valid=false;try{const value=buildStartValidator?.({receipt:row,row,operationId:input.operationId,runId:input.runId,owner:input.owner,sessionId:input.sessionId,model:input.model,reservationUsd:input.reservationUsd,pauseAtDecisionOptions:input.buildStartPauseAtDecisionOptions,binding:input.buildStartBinding});if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});valid=value===true;}catch{}
   if(!valid)return reject('build_start_stale');
   }
   const result=reserveRaw(input);if(!result.accepted){db.exec('ROLLBACK');return result;}
   if(documentPlan&&documentPlanHooks.consumeReservation(documentPlan)!==true)throw Error('Document Plan consumption failed');
   if(localPlanSource){if(localPlanSourceHooks.consumeReservation(localPlanSource)!==true)throw Error('Local Plan source consumption failed');}
   if(nativePlanSource){const value=nativePlanSourceHooks.consumeReservation(nativePlanSource);if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});if(value!==true)throw Error('Native Plan source consumption failed');}
   if(continuation&&packageContinuationHooks.consumeReservation(continuation)!==true)throw Error('Package continuation consumption failed');
   if(handoff){const value=refinementReservationHooks.consumeReservation(handoff);if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});if(value!==true)throw Error('Refinement handoff consumption failed');}
   if(row&&db.prepare('UPDATE build_start_receipts SET operation_id=?,run_id=? WHERE id=? AND operation_id IS NULL AND run_id IS NULL').run(input.operationId,input.runId,row.id).changes!==1)throw Error('Build Start consumption failed');
   if(input.revokeBuildStartPlanRunId!==undefined&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='build_start_receipts'").get())db.prepare('DELETE FROM build_start_receipts WHERE owner=? AND session_id=? AND plan_run_id=? AND operation_id IS NULL AND run_id IS NULL').run(input.owner,input.sessionId,input.revokeBuildStartPlanRunId);
   db.exec('COMMIT');return result;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 },
 async appendEvent(runId,owner,event){const result=db.prepare("INSERT INTO events(run_id,sequence,payload) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id=? AND owner=? AND status='running')").run(runId,event.sequence,JSON.stringify(event),runId,owner);if(result.changes!==1)throw Error('Run is not writable');},
 async saveDraftArtifacts(runId,owner,taskId,artifacts){
  const run=ownerRun(runId,owner);
  if(!run||run.status!=='running'||!/^run_[a-zA-Z0-9-]+$/.test(runId)||!isWorkflowTaskId(taskId)||!Array.isArray(artifacts)||!artifacts.length||artifacts.length>2)throw Error('Invalid draft owner');
  // Drafts belong to this run and never overwrite the session's current files.
  const root=path.join(directory,'draft-artifacts'),runDir=path.join(root,runId),base=path.join(runDir,taskId);
  for(const dir of [root,runDir]){if(existsSync(dir)&&(!lstatSync(dir).isDirectory()||lstatSync(dir).isSymbolicLink()))throw Error('Unsafe draft directory');mkdirSync(dir,{recursive:true,mode:0o700});}
  mkdirSync(base,{mode:0o700});
  let open=false;try{
   db.exec('BEGIN IMMEDIATE');open=true;
   if(ownerRun(runId,owner)?.status!=='running')throw Error('Run is not writable');
   if(db.prepare('SELECT 1 FROM artifacts WHERE run_id=? AND task_id=?').get(runId,taskId))throw Error('Draft already recorded');
   for(const [i,a] of artifacts.entries()){
    if(!a||typeof a.path!=='string'||!/^[-A-Za-z0-9_./]{1,120}$/.test(a.path)||a.path.startsWith('/')||a.path.split('/').some(p=>!p||p==='.'||p==='..')||typeof a.content!=='string')throw Error('Unsafe draft artifact');
    const dest=path.resolve(base,a.path);if(!dest.startsWith(base+path.sep))throw Error('Unsafe draft path');
    mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});writeFileSync(dest,a.content,{flag:'wx',mode:0o600});
    db.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').run(runId,taskId,i,JSON.stringify(a));
   }
   db.exec('COMMIT');open=false;
  }catch(error){if(open)try{db.exec('ROLLBACK');}catch{}rmSync(base,{recursive:true,force:true});throw error;}
 },
 async saveArtifacts(runId,owner,taskId,artifacts){
  db.exec('BEGIN IMMEDIATE');try{
  if(ownerRun(runId,owner)?.status!=='running'||!/^run_[a-zA-Z0-9-]+$/.test(runId)||!isWorkflowTaskId(taskId))throw Error('Invalid artifact owner');
  // Separate tasks in one run must never silently overwrite the same current file.
  // Check the entire batch before any immutable file, row or checkpoint is written.
  // Across-run revisions remain allowed: canonical task IDs are not stable owners
  // across independently reviewed plans, and each update still receives checkpoints.
  const claimed=new Map(db.prepare('SELECT task_id,payload FROM artifacts WHERE run_id=?').all(runId).map(row=>[JSON.parse(row.payload).path,row.task_id]));
  if(artifacts.some(a=>claimed.has(a.path)&&claimed.get(a.path)!==taskId)){
   const error=new Error('artifact_path_conflict');error.code='artifact_path_conflict';error.details={field:'artifact_path',taskIndex:Number(taskId.slice(1))-1};throw error;
  }
  // Only validated, bounded provider strings are saved; they are never imported or executed here.
  const session=ownerRun(runId,owner).session_id;if(!/^[-a-zA-Z0-9_]+$/.test(session))throw Error('Unsafe workspace ID');const workspace=createCheckpoints(path.join(directory,'workspaces',session));const checkpoints=[];
  for(const [i,a] of artifacts.entries()){
   const base=path.join(directory,'artifacts',runId,taskId),dest=path.resolve(base,a.path);
   if(!dest.startsWith(base+path.sep))throw Error('Unsafe artifact path');
   mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});writeFileSync(dest,a.content,{flag:'wx',mode:0o600});
   db.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').run(runId,taskId,i,JSON.stringify(a));
   checkpoints.push(workspace.writeArtifact(a.path,a.content));
  }
  db.exec('COMMIT');return checkpoints;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 },
 async settle({runId,owner,status,chargedUsd,usageKnown,reason='reported_usage',startedCalls=0}){
  const run=ownerRun(runId,owner);if(!run||run.status!=='running'||!Number.isFinite(chargedUsd)||chargedUsd<0||!Number.isInteger(startedCalls)||startedCalls<0||startedCalls>MAX_RUN_MODEL_CALLS)throw Error('Invalid settlement');
  const charged=nano(chargedUsd);
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE runs SET status=?,reserved=0,charged=?,usage_known=?,reason=?,started_calls=?,finished=? WHERE id=? AND owner=? AND status=\'running\'').run(status,charged,usageKnown?1:0,reason,startedCalls,new Date().toISOString(),runId,owner);
   if(charged>run.reserved){db.exec('UPDATE budget SET enabled=0 WHERE id=1');if(providerModel)db.prepare('UPDATE provider_budgets SET enabled=0 WHERE model=?').run(providerModel);}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 },
 async getRun(runId,owner){
  const r=ownerRun(runId,owner);if(!r)return null;
  return {id:r.id,sessionId:r.session_id,status:r.status,reservedUsd:r.reserved/1e9,chargedUsd:r.charged/1e9,usageKnown:!!r.usage_known,events:db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(runId).map(e=>JSON.parse(e.payload))};
 },
 listRuns(){return db.prepare('SELECT id,operation AS operationId,session_id AS sessionId,status FROM runs ORDER BY created').all();},
 summary(){const all=db.prepare('SELECT COUNT(*) AS runs,COALESCE(SUM(reserved),0) AS reserved,COALESCE(SUM(charged),0) AS charged,COALESCE(SUM(started_calls),0) AS calls FROM runs').get();if(providerModel){const b=db.prepare('SELECT * FROM provider_budgets WHERE model=?').get(providerModel),g=db.prepare('SELECT enabled FROM budget WHERE id=1').get();const r=db.prepare('SELECT COUNT(*) AS runs,COALESCE(SUM(reserved),0) AS reserved,COALESCE(SUM(charged),0) AS charged,COALESCE(SUM(started_calls),0) AS calls FROM runs WHERE model=?').get(providerModel),limit=Math.min(b.limit_nano,CAMPAIGN_LIMIT_NANO);return {providerModel,creditBalanceVerified:false,allowanceApprovalId:'baseten-hackathon-100-20261028',limitUsd:limit/1e9,reservedUsd:all.reserved/1e9,chargedUsd:all.charged/1e9,providerReservedUsd:r.reserved/1e9,providerChargedUsd:r.charged/1e9,enabled:!!b.enabled&&!!g.enabled,runs:all.runs,maxCallsPerRun:MAX_RUN_MODEL_CALLS,startedCalls:all.calls,availableUsd:Math.max(0,(limit-all.reserved-all.charged)/1e9)};}const b=db.prepare('SELECT * FROM budget WHERE id=1').get();const r=db.prepare('SELECT COUNT(*) AS runs,COALESCE(SUM(reserved),0) AS reserved,COALESCE(SUM(charged),0) AS charged,COALESCE(SUM(started_calls),0) AS calls FROM runs WHERE model!=\'meta-models/muse-spark-open-1026\'').get();const grant=db.prepare('SELECT approved_limit_nano FROM budget_authorizations WHERE approval_id=?').get(EXTRA_TEST_APPROVAL);return {additionalTestAllowanceUsd:grant?25:null,allowanceApprovalId:grant?EXTRA_TEST_APPROVAL:null,limitUsd:b.limit_nano/1e9,reservedUsd:r.reserved/1e9,chargedUsd:r.charged/1e9,campaignLimitUsd:CAMPAIGN_LIMIT_NANO/1e9,campaignReservedUsd:all.reserved/1e9,campaignChargedUsd:all.charged/1e9,enabled:!!b.enabled,runs:r.runs,maxCallsPerRun:MAX_RUN_MODEL_CALLS,startedCalls:r.calls,availableUsd:Math.max(0,Math.min(b.limit_nano-r.reserved-r.charged,CAMPAIGN_LIMIT_NANO-all.reserved-all.charged)/1e9)};},
 close(){db.close();}
 };
}
