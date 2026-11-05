import {createHash,randomUUID} from 'node:crypto';
const OWNER='local-musepilot-user',hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const safe=x=>Number.isSafeInteger(x)&&x>=0,runId=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]{1,128}$/.test(x);
const add=(a,b)=>{const n=a+b;if(!safe(n))fail('plan_document_usage_liability_unproven');return n;};
// Acknowledgement never settles, refunds, retries or relabels old calls. Every
// record remains unknown and charged. A receipt only permits separate fresh
// review in the same document/session/provider/model scope.
export function createDocumentUsageRecovery({store,activeRuns,currentDocument,recipient,inputPrice,outputPrice,now=Date.now}){
 const db=store.db,reviews=new Map();
 // Preserve legacy receipts. New receipts/items are append-only and atomic.
 db.exec(`CREATE TABLE IF NOT EXISTS document_usage_acknowledgements(session_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,evidence TEXT NOT NULL,scope TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS document_usage_recovery_receipts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,review_id TEXT NOT NULL UNIQUE,binding TEXT NOT NULL,scope TEXT NOT NULL,records TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(owner,session_id,binding));
 CREATE TABLE IF NOT EXISTS document_usage_recovery_items(receipt_id TEXT NOT NULL REFERENCES document_usage_recovery_receipts(id),run_id TEXT NOT NULL REFERENCES runs(id),evidence TEXT NOT NULL,charged_nano INTEGER NOT NULL,unknown_calls INTEGER NOT NULL,PRIMARY KEY(receipt_id,run_id));`);
 function assess(sessionId,{admission=false}={}){
  if(typeof sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(sessionId))fail('plan_document_session_invalid');
  if(!Number.isFinite(inputPrice)||inputPrice<=0||!Number.isFinite(outputPrice)||outputPrice<=0)fail('plan_document_usage_liability_unproven');
  const rows=db.prepare("SELECT * FROM runs WHERE owner=? AND usage_known=0 AND status<>'running' ORDER BY id LIMIT 129").all(OWNER);
  if(!rows.length||rows.length>128)fail('plan_document_usage_not_recoverable');
  if(admission&&(activeRuns.size||db.prepare("SELECT 1 FROM runs WHERE owner=? AND (status='running' OR reserved>0) LIMIT 1").get(OWNER)))fail('plan_document_work_active');
  const doc=currentDocument(sessionId),target=recipient();
  if(!doc||typeof doc.revisionId!=='string'||!/^[a-f0-9]{64}$/.test(doc.documentDigest||'')||!target?.provider||!target?.model)fail('plan_document_usage_not_recoverable');
  const scope={sessionId,revisionId:doc.revisionId,documentDigest:doc.documentDigest,provider:target.provider,model:target.model},records=[];
  let chargedNano=0,unknownCalls=0;
  for(const r of rows){
   if(!runId(r.id)||r.session_id!==sessionId||!['failed','cancelled'].includes(r.status)||r.reserved!==0||!safe(r.charged)||!r.finished||!Number.isFinite(Date.parse(r.finished))||r.reason!=='conservative_unknown_call_charge')fail('plan_document_usage_not_recoverable');
   const events=db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(r.id).map(x=>JSON.parse(x.payload)),start=events[0],terminal=events.at(-1);
   if(start?.type!=='run.started'||start.mode!=='live_model'||start.documentPlan?.action!=='design'||start.documentPlan.revisionId!==doc.revisionId||start.sessionId!==sessionId||terminal?.type!=='run.'+r.status||terminal.runId!==r.id||events.some((e,i)=>e.runId!==r.id||e.sessionId!==sessionId||e.sequence!==i+1)||events.filter(e=>e.type==='run.started').length!==1||events.filter(e=>['run.completed','run.failed','run.cancelled'].includes(e.type)).length!==1||target.model!==r.model||target.provider!==start.providerIdentity?.provider||start.providerIdentity?.model!==target.model)fail('plan_document_usage_not_recoverable');
   const starts=events.filter(e=>e.type==='tool.started'&&e.name==='model.chat.completions'),responses=events.filter(e=>e.type==='model.response'),ids=new Set(starts.map(e=>e.invocationId)),per=start.budgetReservedUsd/start.reservedCalls;
   if(!Number.isSafeInteger(start.reservedCalls)||start.reservedCalls<1||start.reservedCalls>49||!Number.isSafeInteger(r.started_calls)||r.started_calls<1||r.started_calls>start.reservedCalls||starts.length!==r.started_calls||ids.size!==starts.length||starts.some(e=>typeof e.invocationId!=='string'||!e.invocationId)||!Number.isFinite(per)||per<=0||responses.length>=starts.length||new Set(responses.map(e=>e.invocationId)).size!==responses.length)fail('plan_document_usage_not_recoverable');
   let reported=0;
   for(const e of responses){if(!ids.has(e.invocationId)||!safe(e.promptTokens)||!safe(e.outputTokens))fail('plan_document_usage_not_recoverable');reported+=(e.promptTokens*inputPrice+e.outputTokens*outputPrice)/1e6;}
   const missing=starts.length-responses.length,minimum=Math.ceil((reported+missing*per)*1e9);
   if(!safe(minimum)||r.charged<minimum)fail('plan_document_usage_liability_unproven');
   const record={runId:r.id,runStatus:r.status,chargedNano:r.charged,unknownCalls:missing,evidence:hash({r,events})};
   records.push(record);chargedNano=add(chargedNano,r.charged);unknownCalls=add(unknownCalls,missing);
  }
  return {scope,records,chargedNano,unknownCalls};
 }
 const binding=v=>hash({version:2,...v});
 const publicRecords=v=>v.records.map(({evidence,...r})=>r);
 function publicReview(v,id,expiresAt){return{reviewId:id,binding:binding(v),...v.scope,records:publicRecords(v),chargedNano:v.chargedNano,unknownCalls:v.unknownCalls,usageKnown:false,accountingPreserved:true,executionApproval:false,expiresAt};}
 function review(input){if(!exact(input,['sessionId']))fail('plan_document_usage_input_invalid');const v=assess(input.sessionId,{admission:true}),id='docusage_'+randomUUID(),expiresAt=now()+300000;for(const[k,r]of reviews)if(r.expiresAt<=now())reviews.delete(k);if(reviews.size>=100)reviews.delete(reviews.keys().next().value);reviews.set(id,{v,expiresAt});return publicReview(v,id,expiresAt);}
 function validReceipt(row,v){
  if(!row||row.owner!==OWNER||row.session_id!==v.scope.sessionId||row.binding!==binding(v)||row.scope!==JSON.stringify(v.scope)||row.records!==JSON.stringify(v.records))return false;
  const items=db.prepare('SELECT run_id,evidence,charged_nano,unknown_calls FROM document_usage_recovery_items WHERE receipt_id=? ORDER BY run_id').all(row.id);
  return items.length===v.records.length&&items.every((x,i)=>x.run_id===v.records[i].runId&&x.evidence===v.records[i].evidence&&x.charged_nano===v.records[i].chargedNano&&x.unknown_calls===v.records[i].unknownCalls);
 }
 const acknowledgement=(row,v,alreadyAcknowledged)=>({sessionId:v.scope.sessionId,receiptId:row.id,runIds:v.records.map(x=>x.runId),acknowledged:true,usageKnown:false,accountingPreserved:true,executionApproval:false,alreadyAcknowledged});
 function approve(input){
  if(!exact(input,['sessionId','reviewId','binding','approve','acceptUnknownUsage'])||!/^docusage_[A-Za-z0-9-]{1,100}$/.test(input.reviewId||'')||!/^[a-f0-9]{64}$/.test(input.binding||'')||input.approve!==true||input.acceptUnknownUsage!==true)fail('plan_document_usage_consent_required');
  db.exec('BEGIN IMMEDIATE');try{
   const v=assess(input.sessionId,{admission:true});
   if(binding(v)!==input.binding)fail('plan_document_usage_review_stale');
   // Identical approval replay checks a committed receipt, including after restart.
   // It does not dispatch anything or charge again.
   const prior=db.prepare('SELECT * FROM document_usage_recovery_receipts WHERE owner=? AND session_id=? AND binding=?').get(OWNER,input.sessionId,input.binding),receipt=reviews.get(input.reviewId);
   const fresh=receipt&&receipt.expiresAt>now()&&receipt.v.scope.sessionId===input.sessionId&&binding(receipt.v)===input.binding;
   if(!fresh&&(!prior||prior.review_id!==input.reviewId))fail('plan_document_usage_review_expired');
   if(prior){if(!validReceipt(prior,v))fail('plan_document_usage_receipt_invalid');db.exec('COMMIT');reviews.delete(input.reviewId);return acknowledgement(prior,v,true);}
   const id='docusage_receipt_'+randomUUID();
   db.prepare('INSERT INTO document_usage_recovery_receipts VALUES(?,?,?,?,?,?,?,?)').run(id,OWNER,input.sessionId,input.reviewId,input.binding,JSON.stringify(v.scope),JSON.stringify(v.records),now());
   for(const r of v.records)db.prepare('INSERT INTO document_usage_recovery_items VALUES(?,?,?,?,?)').run(id,r.runId,r.evidence,r.chargedNano,r.unknownCalls);
   db.exec('COMMIT');reviews.delete(input.reviewId);return acknowledgement({id},v,false);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function accountingExemption(sessionId){try{
  const v=assess(sessionId),row=db.prepare('SELECT * FROM document_usage_recovery_receipts WHERE owner=? AND session_id=? AND binding=?').get(OWNER,sessionId,binding(v));
  if(validReceipt(row,v))return v.records.map(x=>x.runId);
  // A legacy one-run receipt never silently acknowledges additional records.
  if(v.records.length!==1)return null;
  const old=db.prepare('SELECT * FROM document_usage_acknowledgements WHERE session_id=?').get(sessionId),r=v.records[0];
  return old&&old.run_id===r.runId&&old.evidence===r.evidence&&old.scope===JSON.stringify(v.scope)?r.runId:null;
 }catch{return null;}}
 return {review,approve,accountingExemption};
}
