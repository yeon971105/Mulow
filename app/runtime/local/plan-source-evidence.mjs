import {documentCitationContext,documentSourceEvidenceFields} from '../web/plan-document.js';
// Private immutable source receipt registry. A matched citation is not a tool observation.
import {createHash} from 'node:crypto';
import {preparePlanSource,derivePlanCitations} from '../backend/plan-source-evidence.mjs';
import {safePlanSourceEvidence} from '../web/plan-source-evidence.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
export function createPlanSourceEvidence({store,owner,assertSourceCurrent,allowPublishedBuildBase=()=>false}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS plan_source_receipts(context_id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,run_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL)');
 const events=runId=>db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(runId).map(r=>JSON.parse(r.payload));
 function owned(sessionId,contextId){const row=db.prepare('SELECT * FROM plan_source_receipts WHERE context_id=? AND owner=? AND session_id=?').get(contextId,owner,sessionId);if(!row||hash(JSON.parse(row.payload))!==row.digest)fail('plan_source_receipt_unconfirmed');return {row,payload:JSON.parse(row.payload)};}
 function checkEvidence(plan,sessionId){
  if(plan.planSourceEvidence===undefined)return null;
  const evidence=safePlanSourceEvidence(plan.planSourceEvidence,plan);if(!evidence.receipt)return null;
  const {row,payload}=owned(sessionId,evidence.receipt.contextId),run=db.prepare('SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?').get(row.run_id,owner,sessionId);
  if(!run||run.status!=='completed'||run.usage_known!==1||run.reserved!==0||JSON.stringify(payload.receipt)!==JSON.stringify(evidence.receipt))fail('plan_source_response_unconfirmed');
  const history=events(run.id),identity=history.find(e=>e.type==='run.started')?.providerIdentity;if(run.model!==evidence.receipt.model||identity?.provider!==evidence.receipt.provider||identity?.model!==evidence.receipt.model)fail('plan_source_recipient_unconfirmed');if(!history.some(e=>e.type==='tool.completed'&&e.invocationId===evidence.receipt.invocationId)||history.some(e=>e.type==='tool.failed'&&e.invocationId===evidence.receipt.invocationId))fail('plan_source_dispatch_unconfirmed');
  const emitted=history.filter(e=>['plan.created','plan.proposed','plan.document.proposed'].includes(e.type)).map(e=>(e.proposal||e).planSourceEvidence).find(e=>e&&JSON.stringify(e.receipt)===JSON.stringify(evidence.receipt)&&JSON.stringify(e.warnings)===JSON.stringify(evidence.warnings)&&evidence.citations.every(c=>e.citations.some(original=>JSON.stringify(original)===JSON.stringify(c))));
  if(!emitted||history.at(-1)?.type!=='run.completed')fail('plan_source_plan_unbound');
  const documentOrigin=history.find(e=>e.type==='plan.document.proposed'&&e.planSourceEvidence?.receipt?.contextId===evidence.receipt.contextId);if(documentOrigin){const original=documentCitationContext(documentOrigin.document).planArtifact.hypotheses;for(const c of evidence.citations){const prior=original.find(h=>h.id===c.hypothesisId),current=plan.planArtifact?.hypotheses?.find(h=>h.id===c.hypothesisId);if(!prior||!current||prior.statement!==current.statement)fail('document_source_hypothesis_changed');}}
  const proposed=evidence.citations.map(({hypothesisId,sourceRefId,startLine,endLine})=>({hypothesisId,sourceRefId,startLine,endLine}));
  const derived=derivePlanCitations(proposed,evidence.receipt,payload.source,plan);
  if(evidence.citations.length&&JSON.stringify(derived.citations)!==JSON.stringify(evidence.citations))fail('plan_source_citation_changed');
  return {row,payload,run};
 }
 return {
  record({sessionId,runId,receipt,source,sourceBinding,usageKnown}){
   if(usageKnown!==true)fail('plan_source_usage_unconfirmed');
   const run=db.prepare('SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?').get(runId,owner,sessionId);if(!run||run.status!=='running'||receipt.sourceRunId!==runId)fail('plan_source_active_run_required');
   safePlanSourceEvidence({version:1,receipt,citations:[],warnings:[]});
   const prepared=preparePlanSource({source,sourceKind:receipt.sourceKind,sourceBinding,owner,sessionId,runId,invocationId:receipt.invocationId});
   const {source:ignored,sourceBinding:ignoredBinding,...expected}=prepared;const {bodySha256,bodyBytes,provider,model,...received}=receipt;
   if(JSON.stringify(expected)!==JSON.stringify(received))fail('plan_source_receipt_changed');
   const history=events(runId),identity=history.find(e=>e.type==='run.started')?.providerIdentity;if(run.model!==model||identity?.provider!==provider||identity?.model!==model)fail('plan_source_recipient_unconfirmed');
   const started=history.find(e=>e.type==='tool.started'&&e.invocationId===receipt.invocationId),requested=history.find(e=>e.type==='plan.source.requested'&&e.invocationId===receipt.invocationId&&e.contextId===receipt.contextId),supplied=history.find(e=>e.type==='plan.source.supplied'&&JSON.stringify(e.receipt)===JSON.stringify(receipt));
   if(!started||!requested||!supplied||started.name!=='model.chat.completions'||requested.requestEvidence?.bodySha256!==bodySha256||requested.requestEvidence?.bodyBytes!==bodyBytes||requested.requestEvidence?.model!==model||history.some(e=>e.type==='tool.failed'&&e.invocationId===receipt.invocationId))fail('plan_source_dispatch_unconfirmed');
   const payload={receipt,source,sourceBinding},digest=hash(payload),prior=db.prepare('SELECT digest FROM plan_source_receipts WHERE context_id=?').get(receipt.contextId);if(prior){if(prior.digest!==digest)fail('plan_source_receipt_changed');return receipt;}
   db.prepare('INSERT INTO plan_source_receipts VALUES(?,?,?,?,?,?)').run(receipt.contextId,owner,sessionId,runId,JSON.stringify(payload),digest);return receipt;
  },
  verifyPlan(plan,sessionId){checkEvidence(plan,sessionId);return true;},
  verifyDocument(document,evidence,sessionId){const fields=documentSourceEvidenceFields(document,evidence);checkEvidence({...documentCitationContext(document),...fields},sessionId);return true;},
  assertCurrentForPlan(plan,sessionId){const checked=checkEvidence(plan,sessionId);if(!checked)return true;try{if(typeof assertSourceCurrent!=='function'||assertSourceCurrent({...checked.payload,sessionId,runId:checked.run.id,operationId:checked.run.operation})!==true)fail('plan_source_current_unconfirmed');}catch(error){if(checked.payload.receipt.sourceKind!=='native'||allowPublishedBuildBase({plan,sessionId,receipt:checked.payload.receipt})!==true)throw error;}return true;}
 };
}
