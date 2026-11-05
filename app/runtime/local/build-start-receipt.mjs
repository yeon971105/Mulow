import {randomUUID,createHash} from 'node:crypto';
import {admitStaticPackages} from '../backend/project-output/package-admission.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
export function createBuildStartReceipts({store,snapshot,model,perCallCeiling,available,validatePlanSource=()=>{},readiness=()=>null,owner='local-musepilot-user',now=Date.now}){
 const db=store.db;db.exec('CREATE TABLE IF NOT EXISTS build_start_receipts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,plan_run_id TEXT NOT NULL,binding TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,operation_id TEXT,run_id TEXT)');
 function current(sessionId,planRunId,consent,pauseAtDecisionOptions,admissionContext={}){
  if(pauseAtDecisionOptions!==undefined&&typeof pauseAtDecisionOptions!=='boolean')fail('build_start_pause_preference_invalid');
  if(readiness(sessionId)?.approvalBlocked)fail('planning_needs_clarification');const state=snapshot(sessionId);if(state.planRunId!==planRunId)fail('build_start_stale');
  const row=db.prepare("SELECT id FROM runs WHERE id=? AND owner=? AND session_id=? AND status='completed'").get(planRunId,owner,sessionId);
  if(!row||!db.prepare('SELECT 1 FROM plan_approvals WHERE run_id=? AND session_id=?').get(planRunId,sessionId))fail('approved_plan_required');
  const plan=db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(planRunId).map(x=>JSON.parse(x.payload)).find(e=>e.type==='plan.created'&&e.interactionMode==='plan');
  validatePlanSource({sessionId,planRunId,plan,...admissionContext});
  const admitted=admitStaticPackages({mode:'agent',outputMode:'project',planRunId,executionStrategy:'automatic',strategyConsent:consent,pauseAtDecisionOptions},plan,available());
  const ceiling=perCallCeiling()*admitted.maxModelCalls;if(!Number.isFinite(ceiling)||ceiling<=0)fail('build_start_cost_unavailable');
  return {state,consent,model:model(),maxReservationUsd:ceiling,...(pauseAtDecisionOptions===true?{pauseAtDecisionOptions:true}:{})};
 }
 function inspect(input){const row=db.prepare('SELECT * FROM build_start_receipts WHERE id=?').get(input.buildStartReceiptId);if(!row||row.owner!==owner||row.session_id!==input.sessionId||row.plan_run_id!==input.planRunId||row.operation_id||row.expires<=now())fail('build_start_receipt_unavailable');const payload=current(input.sessionId,input.planRunId,input.strategyConsent,input.pauseAtDecisionOptions);if(sha(payload)!==row.binding)fail('build_start_stale');return {row,payload};}
 return {
  issue(input){const payload=current(input.sessionId,input.runId,input.strategyConsent,input.pauseAtDecisionOptions);if(!Number.isFinite(input.maxReservationUsd)||Math.abs(input.maxReservationUsd-payload.maxReservationUsd)>1e-9)fail('build_start_cost_changed');const id='buildstart_'+randomUUID(),expires=now()+300000;db.prepare('DELETE FROM build_start_receipts WHERE session_id=? AND operation_id IS NULL').run(input.sessionId);db.prepare('INSERT INTO build_start_receipts(id,owner,session_id,plan_run_id,binding,payload,created,expires) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,input.sessionId,input.runId,sha(payload),JSON.stringify(payload),now(),expires);return {buildStartReceiptId:id,expiresAt:expires,executionStrategy:'automatic',pauseAtDecisionOptions:payload.pauseAtDecisionOptions===true,maxModelCalls:payload.consent.maxModelCalls,maxReservationUsd:payload.maxReservationUsd};},
  binding(input){return inspect(input).row.binding;},
  validate({row,owner:requestOwner,sessionId,model:requestModel,binding,reservationUsd,pauseAtDecisionOptions,operationId,runId}){if(requestOwner!==owner||row.session_id!==sessionId||row.binding!==binding)return false;const saved=JSON.parse(row.payload);if(pauseAtDecisionOptions!==undefined&&typeof pauseAtDecisionOptions!=='boolean'||(pauseAtDecisionOptions===true)!==(saved.pauseAtDecisionOptions===true))return false;const actual=current(sessionId,row.plan_run_id,saved.consent,saved.pauseAtDecisionOptions,{operationId,runId});return sha(actual)===binding&&requestModel===actual.model&&Number.isFinite(reservationUsd)&&reservationUsd<=actual.maxReservationUsd+1e-9;}
 };
}
