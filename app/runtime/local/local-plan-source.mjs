// Local selected files are one-turn planning references, never a published/adopted build base.
import {createHash,randomUUID} from 'node:crypto';
import {LOCAL_PLAN_SOURCE_PROFILE,LOCAL_PLAN_SOURCE_POLICY,validateLocalPlanFiles} from '../web/local-plan-source-contract.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const LOCAL_PLAN_SOURCE_PROFILE_DIGEST=hash(LOCAL_PLAN_SOURCE_POLICY);
export function createLocalPlanSource({db,owner,readCurrent,preflight,now=Date.now}){
 if(!db||!owner||typeof readCurrent!=='function'||typeof preflight!=='function')fail('local_plan_source_authority_required');
 db.exec(`CREATE TABLE IF NOT EXISTS local_plan_source_reviews(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,operation_id TEXT UNIQUE,run_id TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS local_plan_source_heads(owner TEXT NOT NULL,session_id TEXT NOT NULL,source_digest TEXT NOT NULL,PRIMARY KEY(owner,session_id));`);
 const head=sessionId=>db.prepare('SELECT source_digest FROM local_plan_source_heads WHERE owner=? AND session_id=?').get(owner,sessionId)?.source_digest||null;
 function current(sessionId,documentContext,ignoreRunId=null,ignoreOperationId=null){
  if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||!exact(documentContext,['revisionId','documentDigest'])||!((documentContext.revisionId===null&&documentContext.documentDigest===null)||/^plandoc_[A-Za-z0-9-]+$/.test(documentContext.revisionId||'')&&sha(documentContext.documentDigest)))fail('local_plan_source_input_invalid');
  const c=readCurrent({owner,sessionId,documentContext,ignoreRunId,ignoreOperationId});
  if(!c||c.then||!same(c.documentContext,documentContext)||c.context?.blocked||c.context?.recipient?.provider!=='baseten'||c.context?.recipient?.model!=='meta-models/muse-spark-open-1026')fail('local_plan_source_context_unavailable');
  return structuredClone(c);
 }
 function owned(sessionId,reviewId,binding){const r=db.prepare('SELECT * FROM local_plan_source_reviews WHERE id=? AND owner=? AND session_id=?').get(reviewId,owner,sessionId);if(!r||!sha(binding)||r.digest!==binding||hash(JSON.parse(r.payload))!==binding||r.revoked)fail('local_plan_source_review_invalid');return r;}
 const fresh=r=>{if(r.run_id||r.operation_id||r.expires<=now())fail('local_plan_source_review_expired_or_used');};
 function check(r,ignoreRunId=null,ignoreOperationId=null){const p=JSON.parse(r.payload),c=current(r.session_id,p.documentContext,ignoreRunId,ignoreOperationId);if(p.profileDigest!==LOCAL_PLAN_SOURCE_PROFILE_DIGEST||head(r.session_id)!==p.sourceDigest||!same(c,p.authority))fail('local_plan_source_context_changed');return {p,c};}
 function summary(r){const p=JSON.parse(r.payload);return freeze({reviewId:r.id,binding:r.digest,sessionId:r.session_id,profile:LOCAL_PLAN_SOURCE_PROFILE,profileDigest:p.profileDigest,provider:p.authority.context.recipient.provider,model:p.authority.context.recipient.model,planningInputRevision:p.planningInputRevision,documentContext:p.documentContext,requestDigest:p.requestDigest,sourceDigest:p.sourceDigest,files:p.files,fileCount:p.files.length,bytes:p.files.reduce((n,f)=>n+f.bytes,0),expiresAt:r.expires,coverage:'complete_selected_files',execution:'not_run',consent:'required_for_this_plan',maxModelCalls:1,...p.preflight});}
 return {
  currentBinding({sessionId}){const digest=head(sessionId);return digest?{profile:LOCAL_PLAN_SOURCE_PROFILE,sourceDigest:digest}:null;},
  async review(input){
   if(!exact(input,['sessionId','planningInputRevision','documentContext','requestText','profile','files'])||input.profile!==LOCAL_PLAN_SOURCE_PROFILE||typeof input.requestText!=='string'||!input.requestText.trim()||input.requestText!==input.requestText.trim()||Buffer.byteLength(input.requestText)>6000||typeof input.planningInputRevision!=='string'||!input.planningInputRevision.startsWith(input.sessionId+':inputs:')||!/^\d{1,16}$/.test(input.planningInputRevision.slice((input.sessionId+':inputs:').length))||!Number.isSafeInteger(Number(input.planningInputRevision.slice((input.sessionId+':inputs:').length))))fail('local_plan_source_input_invalid');
   let files;try{files=validateLocalPlanFiles(input.files);}catch{fail('local_plan_source_files_rejected');}
   const before=current(input.sessionId,input.documentContext),sourceDigest=hash({profile:LOCAL_PLAN_SOURCE_PROFILE,files}),source={provenance:'explicit_reviewed_local_source',revision:sourceDigest,profile:LOCAL_PLAN_SOURCE_PROFILE,coverage:'complete_selected_files',projectMetadata:'not_inferred',files,entrypoints:[],dependencies:[]};
   const inspected=await preflight({source,requestText:input.requestText,current:before});
   if(!inspected||inspected.maxModelCalls!==1||!Number.isFinite(inspected.perCallReservationUsd)||inspected.perCallReservationUsd<=0||inspected.reservationUsd!==inspected.perCallReservationUsd||!Number.isSafeInteger(inspected.inputBytes)||inspected.inputBytes>80000||!Number.isSafeInteger(inspected.bodyBytes)||inspected.bodyBytes>96000)fail('local_plan_source_preflight_invalid');
   db.exec('BEGIN IMMEDIATE');try{
    if(!same(current(input.sessionId,input.documentContext),before))fail('local_plan_source_context_changed');
    const time=now();db.prepare('DELETE FROM local_plan_source_reviews WHERE owner=? AND run_id IS NULL AND operation_id IS NULL AND (expires<=? OR revoked=1)').run(owner,time);
    if(db.prepare('SELECT count(*) n FROM local_plan_source_reviews WHERE owner=? AND run_id IS NULL AND expires>?').get(owner,time).n>=32||db.prepare('SELECT count(*) n FROM local_plan_source_reviews WHERE owner=? AND session_id=? AND run_id IS NULL AND expires>?').get(owner,input.sessionId,time).n>=8)fail('local_plan_source_review_limit');
    // A fresh explicit review supersedes unused consent (including A→B→A) and removes its untransmitted source copy; consumed provenance stays intact.
    db.prepare('DELETE FROM local_plan_source_reviews WHERE owner=? AND session_id=? AND run_id IS NULL AND operation_id IS NULL').run(owner,input.sessionId);
    db.prepare('INSERT INTO local_plan_source_heads VALUES(?,?,?) ON CONFLICT(owner,session_id) DO UPDATE SET source_digest=excluded.source_digest').run(owner,input.sessionId,sourceDigest);
    const payload={profileDigest:LOCAL_PLAN_SOURCE_PROFILE_DIGEST,documentContext:input.documentContext,authority:current(input.sessionId,input.documentContext),planningInputRevision:input.planningInputRevision,requestDigest:hash(input.requestText),sourceDigest,source,files:files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.content),sha256:createHash('sha256').update(f.content).digest('hex')})),preflight:inspected};
    const stored=JSON.stringify(payload),usage=db.prepare('SELECT count(*) n,COALESCE(sum(length(CAST(payload AS BLOB))),0) bytes FROM local_plan_source_reviews WHERE owner=? AND session_id=?').get(owner,input.sessionId);if(usage.n>=2048||usage.bytes+Buffer.byteLength(stored)>16777216)fail('local_plan_source_storage_limit');
    const id='localsource_'+randomUUID(),binding=hash(payload);db.prepare('INSERT INTO local_plan_source_reviews(id,owner,session_id,payload,digest,created,expires) VALUES(?,?,?,?,?,?,?)').run(id,owner,input.sessionId,stored,binding,time,time+300000);
    db.exec('COMMIT');return summary(owned(input.sessionId,id,binding));
   }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
  },
  resolveLocal(input,caller){if(caller!==owner||input.allowModelContext!==true)fail('local_plan_source_consent_required');const row=owned(input.sessionId,input.reviewId,input.binding);fresh(row);const {p}=check(row,null,input.operationId);if(!same(input.documentContext,p.documentContext)||input.planningInputRevision!==p.planningInputRevision||hash(input.requestText)!==p.requestDigest)fail('local_plan_source_request_changed');return freeze({reviewId:row.id,binding:row.digest,authority:p.authority,profileDigest:p.profileDigest,requestDigest:p.requestDigest,planningInputRevision:p.planningInputRevision,source:p.source,preflight:p.preflight});},
  validateReservation(input){try{if(!db.isTransaction||input.owner!==owner)return false;const r=owned(input.sessionId,input.reviewId,input.binding);fresh(r);const {p}=check(r,null,input.operationId);return input.requestDigest===p.requestDigest&&input.planningInputRevision===p.planningInputRevision&&input.model===p.authority.context.recipient.model&&input.maxModelCalls===1&&input.perCallReservationUsd===p.preflight.perCallReservationUsd&&input.reservationUsd===p.preflight.reservationUsd&&typeof input.runId==='string'&&typeof input.operationId==='string';}catch{return false;}},
  consumeReservation(input){if(!db.isTransaction||input.owner!==owner)return false;return db.prepare('UPDATE local_plan_source_reviews SET run_id=?,operation_id=? WHERE id=? AND owner=? AND session_id=? AND digest=? AND revoked=0 AND run_id IS NULL AND operation_id IS NULL AND expires>?').run(input.runId,input.operationId,input.reviewId,owner,input.sessionId,input.binding,now()).changes===1;},
  assertCurrent(input,caller){if(caller!==owner)fail('local_plan_source_not_owned');const r=owned(input.sessionId,input.reviewId,input.binding);if(r.run_id!==input.runId||r.operation_id!==input.operationId)fail('local_plan_source_run_changed');check(r,input.runId,input.operationId);return true;},
  assertSourceCurrent(input,caller){if(caller!==owner)fail('local_plan_source_not_owned');const r=owned(input.sessionId,input.reviewId,input.binding),p=JSON.parse(r.payload);if(r.run_id!==input.runId||r.operation_id!==input.operationId||head(input.sessionId)!==p.sourceDigest)fail('local_plan_source_changed');return true;},
  revoke(input){if(!exact(input,['sessionId','reviewId','binding']))fail('local_plan_source_input_invalid');const r=owned(input.sessionId,input.reviewId,input.binding);if(r.run_id||r.operation_id)fail('local_plan_source_review_expired_or_used');db.prepare('DELETE FROM local_plan_source_reviews WHERE id=? AND run_id IS NULL AND operation_id IS NULL').run(r.id);return {revoked:true,reviewId:r.id};}
 };
}
