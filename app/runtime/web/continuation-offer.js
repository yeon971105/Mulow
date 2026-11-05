import {reservationLabel} from './recovery-offer.js';
/** Local display eligibility only. Server preview independently verifies durable evidence. */
export function continuationOffer(s,group=null){
 const ids=new Set(group?.taskIds||[]),repair=(s.runs||[]).findLast(r=>r.recoveryCompleted&&r.status==='completed'&&(!group||ids.has(r.id+':'+r.recovery?.taskId)||group.continuationReady&&group.tasks?.some(t=>t.runId===r.recovery?.originalRunId)));
 if(!repair?.recovery||s.liveRun?.status==='running'||(s.runs||[]).some(r=>r.continuation?.recoveryRunId===repair.id))return null;
 return {failedRunId:repair.recovery.originalRunId,recoveryRunId:repair.id};
}
export function renderContinuationOffer(s,group,esc){const offer=continuationOffer(s,group);if(!offer)return '';return '<section class="progress-problem"><strong>Repair saved · remaining work not run</strong><p>Review the original workflow’s remaining tasks and budget before continuing. Completed work will be reused, not rerun.</p><button data-continuation-preview="'+esc(offer.failedRunId+':'+offer.recoveryRunId)+'">Review continuation</button><small>Preview sends no model request. A new approval is required.</small></section>';}
export function renderContinuationConfirmation(preview,esc,{busy=false,error=''}={}){
 const tasks=Array.isArray(preview?.remainingTasks)?preview.remainingTasks:[];
 return '<section class="detail-section recovery-confirmation"><h2>Continue remaining work?</h2>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+'<p>Paid calls author only the remaining approved tasks, one at a time. Completed outputs and the repair are reused; no automatic retry.</p><p class="approval-cost">Reserve up to '+esc(reservationLabel(preview?.reservationUsd))+'. The recorded test allowance remains enforced.</p><p>Source files only — no generated code, build, or tests run.</p><details><summary>Review remaining tasks · '+tasks.length+'</summary><p>'+esc(preview?.goal||'Original approved goal')+'</p><ul>'+tasks.map(t=>'<li>'+esc(t.title||t.id)+'</li>').join('')+'</ul></details><div class="approval-actions"><button data-action="cancel-editor">Cancel</button><button data-action="approve-continuation"'+(busy?' disabled':'')+'>Continue</button></div></section>';
}
