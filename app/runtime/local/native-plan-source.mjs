// Explicit one-use Plan sharing authority. Build/Agent permission is never consulted.
import {createHash,randomUUID} from 'node:crypto';
import {relativePath} from '../backend/project-output/contract.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
import {PLAN_STRUCTURAL_REPAIR_POLICY as repairPolicy,isPlanStructuralRepairPolicy} from '../web/plan-repair-contract.js';
const hasRepair=p=>isPlanStructuralRepairPolicy(p.structuralRepair);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function createNativePlanSource({db,owner,readCurrent,now=Date.now}){
 if(!db||!owner||typeof readCurrent!=='function')fail('native_plan_source_authority_required');
 db.exec(`CREATE TABLE IF NOT EXISTS native_plan_source_reviews(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,operation_id TEXT,run_id TEXT);`);
 function current(sessionId,ignoreRunId=null,ignoreOperationId=null,requireIdle=true,documentContext){
  if(typeof sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(sessionId))fail('native_plan_source_invalid_session');
  const c=readCurrent({owner,sessionId,ignoreRunId,ignoreOperationId,documentContext});
  if(!c||c.then||c.owner!==owner||c.sessionId!==sessionId||(requireIdle&&c.idle!==true)||!c.provider||!c.model||!/^run_[A-Za-z0-9-]+$/.test(c.planRunId||'')||!sha(c.planDigest)||!/^run_[A-Za-z0-9-]+$/.test(c.nativeRunId||'')||!sha(c.nativeRevision)||!sha(c.nativeCurrentHash)||!sha(c.nativeRecordDigest))fail('native_plan_source_unavailable');
  if(!Array.isArray(c.files)||!c.files.length||c.files.length>200||!Array.isArray(c.dependencies)||!Array.isArray(c.entrypoints))fail('native_plan_source_snapshot_invalid');
  const names=new Set(),spellings=new Map();let bytes=0;
  const files=c.files.map(f=>{
   if(!f||typeof f.content!=='string'||Buffer.from(f.content).toString('utf8')!==f.content)fail('native_plan_source_snapshot_invalid');
   const path=relativePath(f.path),key=path.toLowerCase(),segments=path.split('/');
   for(let i=1;i<=segments.length;i++){const prefix=segments.slice(0,i).join('/'),folded=prefix.toLowerCase();if(spellings.has(folded)&&spellings.get(folded)!==prefix)fail('native_plan_source_path_collision');spellings.set(folded,prefix);}
   if(names.has(key)||[...names].some(n=>n.startsWith(key+'/')||key.startsWith(n+'/')))fail('native_plan_source_path_collision');
   names.add(key);bytes+=Buffer.byteLength(f.content);if(bytes>1000000)fail('native_plan_source_too_large');
   return {path,content:f.content};
  }).sort((a,b)=>a.path<b.path?-1:1);
  const source={provenance:'explicit_reviewed_native_source',revision:c.nativeRevision,files,entrypoints:structuredClone(c.entrypoints),dependencies:structuredClone(c.dependencies)};
  if(documentContext!==undefined&&(!documentContext||Object.keys(documentContext).sort().join(',')!=='documentDigest,revisionId'||!((documentContext.revisionId===null&&documentContext.documentDigest===null)||(/^plandoc_[A-Za-z0-9-]+$/.test(documentContext.revisionId||'')&&sha(documentContext.documentDigest)))||JSON.stringify(c.documentContext)!==JSON.stringify(documentContext)))fail('native_plan_source_document_changed');
  const authority={owner,sessionId,...(documentContext!==undefined?{documentContext}:{}),provider:c.provider,model:c.model,recipientPolicyDigest:c.recipientPolicyDigest||null,goalEpoch:c.goalEpoch||null,planRunId:c.planRunId,planDigest:c.planDigest,nativeRunId:c.nativeRunId,nativeRevision:c.nativeRevision,nativeCurrentHash:c.nativeCurrentHash,nativeRecordDigest:c.nativeRecordDigest,sourceDigest:hash(source)};
  return {authority,source};
 }
 function owned(sessionId,reviewId,digest){
  const row=db.prepare('SELECT * FROM native_plan_source_reviews WHERE id=? AND owner=? AND session_id=?').get(reviewId,owner,sessionId);
  if(!row||!sha(digest)||row.digest!==digest||hash(JSON.parse(row.payload))!==digest||row.revoked)fail('native_plan_source_review_invalid');
  return row;
 }
 function check(row,ignoreRunId=null,ignoreOperationId=null){
  const p=JSON.parse(row.payload),c=current(row.session_id,ignoreRunId,ignoreOperationId,true,p.authority.documentContext);
  if(JSON.stringify(c.authority)!==JSON.stringify(p.authority))fail('native_plan_source_changed');
  return {p,c};
 }
 function fresh(row){if(row.run_id||row.operation_id||row.expires<=now())fail('native_plan_source_review_expired_or_used');}
 function summary(row){const p=JSON.parse(row.payload);return freeze({reviewId:row.id,binding:row.digest,sessionId:row.session_id,provider:p.authority.provider,model:p.authority.model,planRunId:p.authority.planRunId,planningInputRevision:p.planningInputRevision,requestDigest:p.requestDigest,sourceRevision:p.authority.nativeRevision,sourceRunId:p.authority.nativeRunId,recordDigest:p.authority.nativeRecordDigest,sourceDigest:p.authority.sourceDigest,files:p.files,fileCount:p.files.length,bytes:p.files.reduce((n,f)=>n+f.bytes,0),expiresAt:row.expires,coverage:'complete_snapshot',execution:'not_run',consent:'required_for_this_plan',...(p.authority.documentContext!==undefined?{documentContext:p.authority.documentContext}:{}),...(p.structuralRepair?{structuralRepair:p.structuralRepair}:{})});}
 return {
  review({sessionId,planningInputRevision,requestText,allowStructuralRepair,documentContext}){
   if(allowStructuralRepair!==undefined&&typeof allowStructuralRepair!=='boolean')fail('native_plan_source_input_invalid');
   if(typeof planningInputRevision!=='string'||!planningInputRevision.startsWith(sessionId+':inputs:')||!/^\d{1,16}$/.test(planningInputRevision.slice((sessionId+':inputs:').length))||!Number.isSafeInteger(Number(planningInputRevision.slice((sessionId+':inputs:').length)))||typeof requestText!=='string'||!requestText.trim()||Buffer.byteLength(requestText)>16000)fail('native_plan_source_input_invalid');
   if(documentContext!==undefined&&allowStructuralRepair===true)fail('native_plan_source_input_invalid');
   const {authority,source}=current(sessionId,null,null,true,documentContext),payload={authority,...(allowStructuralRepair===true?{structuralRepair:repairPolicy}:{}),planningInputRevision,requestDigest:hash(requestText.trim()),files:source.files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.content),sha256:createHash('sha256').update(f.content).digest('hex')}))},id='plansource_'+randomUUID(),digest=hash(payload),created=now();
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('DELETE FROM native_plan_source_reviews WHERE owner=? AND run_id IS NULL AND operation_id IS NULL AND expires<=?').run(owner,created);
    const prior=db.prepare('SELECT * FROM native_plan_source_reviews WHERE owner=? AND session_id=? AND digest=? AND revoked=0 AND run_id IS NULL AND operation_id IS NULL AND expires>?').get(owner,sessionId,digest,created);
    if(prior){db.exec('COMMIT');return summary(prior);}
    if(db.prepare('SELECT count(*) n FROM native_plan_source_reviews WHERE owner=? AND run_id IS NULL AND expires>?').get(owner,created).n>=32||db.prepare('SELECT count(*) n FROM native_plan_source_reviews WHERE owner=? AND session_id=? AND run_id IS NULL AND expires>?').get(owner,sessionId,created).n>=8)fail('native_plan_source_review_limit');
    db.prepare('INSERT INTO native_plan_source_reviews(id,owner,session_id,payload,digest,created,expires) VALUES(?,?,?,?,?,?,?)').run(id,owner,sessionId,JSON.stringify(payload),digest,created,created+300000);
    db.exec('COMMIT');return summary(owned(sessionId,id,digest));
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  },
  resolveNative(input,caller){
   if(caller!==owner||input.allowModelContext!==true)fail('native_plan_source_consent_required');
   const row=owned(input.sessionId,input.reviewId,input.binding);fresh(row);const {p,c}=check(row,null,input.operationId);
   if(JSON.stringify(input.documentContext)!==JSON.stringify(p.authority.documentContext))fail('native_plan_source_document_changed');
   if(input.planningInputRevision!==p.planningInputRevision||typeof input.requestText!=='string'||hash(input.requestText.trim())!==p.requestDigest)fail('native_plan_source_request_changed');
   return freeze({reviewId:row.id,binding:row.digest,authority:p.authority,requestDigest:p.requestDigest,planningInputRevision:p.planningInputRevision,source:c.source,...(p.structuralRepair?{structuralRepair:p.structuralRepair}:{})});
  },
  validateReservation(input){
   try{if(!db.isTransaction||input.owner!==owner)return false;const row=owned(input.sessionId,input.reviewId,input.binding);fresh(row);const {p}=check(row,null,input.operationId);const count=input.maxModelCalls??1;if(![1,2].includes(count)||count!==(hasRepair(p)?2:1))return false;if(count===2){const per=input.perCallReservationUsd,total=input.reservationUsd;if(!Number.isFinite(per)||per<=0||!Number.isFinite(total)||total<=0||!Number.isSafeInteger(Math.ceil(per*2*1e9))||Math.ceil(per*2*1e9)!==Math.ceil(total*1e9))return false;}return input.requestDigest===p.requestDigest&&input.planningInputRevision===p.planningInputRevision&&input.model===p.authority.model&&typeof input.runId==='string'&&typeof input.operationId==='string';}catch{return false;}
  },
  consumeReservation(input){
   if(!db.isTransaction||input.owner!==owner)return false;
   return db.prepare('UPDATE native_plan_source_reviews SET operation_id=?,run_id=? WHERE id=? AND owner=? AND session_id=? AND digest=? AND revoked=0 AND run_id IS NULL AND operation_id IS NULL AND expires>?').run(input.operationId,input.runId,input.reviewId,owner,input.sessionId,input.binding,now()).changes===1;
  },
  assertCurrent(input,caller){
   if(caller!==owner)fail('native_plan_source_not_owned');const row=owned(input.sessionId,input.reviewId,input.binding||input.digest);
   if(row.run_id!==input.runId||row.operation_id!==input.operationId)fail('native_plan_source_run_changed');if(JSON.stringify(input.documentContext)!==JSON.stringify(JSON.parse(row.payload).authority.documentContext))fail('native_plan_source_document_changed');if(input.structuralRepairAttempt!==undefined){if(input.structuralRepairAttempt!==1||!hasRepair(JSON.parse(row.payload))||row.expires<=now())fail('native_plan_source_repair_not_authorized');}check(row,input.runId,input.operationId);return true;
  },
  assertSourceCurrent(input,caller){
   if(caller!==owner)fail('native_plan_source_not_owned');const row=owned(input.sessionId,input.reviewId,input.binding);if(row.run_id!==input.runId||row.operation_id!==input.operationId)fail('native_plan_source_run_changed');
   const expected=JSON.parse(row.payload).authority,actual=current(input.sessionId,input.ignoreRunId||null,null,false).authority;const physical=a=>{const {planRunId,planDigest,documentContext,...rest}=a;return rest;};if(JSON.stringify(physical(expected))!==JSON.stringify(physical(actual)))fail('native_plan_source_changed');return true;
  },
  revoke({sessionId,reviewId,binding}){const row=owned(sessionId,reviewId,binding);db.prepare('UPDATE native_plan_source_reviews SET revoked=1 WHERE id=?').run(row.id);return {revoked:true,reviewId:row.id};},
  inspect:({sessionId,reviewId,binding})=>summary(owned(sessionId,reviewId,binding))
 };
}
