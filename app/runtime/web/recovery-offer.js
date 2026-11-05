/** An offer is not approval. Only server preview/approval may authorize another call. */
export function recoveryOffer(s,group){
 const ids=new Set(group?.taskIds||[]),failure=(s.events||[]).findLast(e=>e.type==='task.failed'&&ids.has(e.taskId)&&['architecture_output_required','invalid_architecture_output'].includes(e.code||e.summary));
 if(failure&&(s.events||[]).some(e=>e.runId===failure.runId&&e.type==='project.generating'&&e.strategy==='staged-artifacts-v1'))return null;
 if(!failure||s.runs?.some(r=>r.recovery?.originalRunId===failure.runId&&failure.taskId===r.recovery.originalRunId+':'+r.recovery.originalTaskId))return null;
 const task=s.workflow?.tasks?.find(t=>t.id===failure.taskId);if(task?.status!=='failed'||task.recovery)return null;
 return {originalRunId:failure.runId,originalTaskId:failure.taskId.slice(failure.runId.length+1),code:failure.code||failure.summary};
}
export function renderRecoveryOffer(s,group,esc){
 const offer=recoveryOffer(s,group);if(!offer)return '';
 return '<section class="progress-problem"><strong>Architecture format invalid</strong><p>The required component design was not accepted.</p><button data-recovery-preview="'+esc(offer.originalRunId+':'+offer.originalTaskId)+'" aria-label="Review architecture repair">Repair design</button><small>Review first · paid approval before repair</small><details class="recovery-context"><summary>Scope &amp; cause</summary><p>One correction of the same approved task and source context. Review sends no model request. The model’s underlying reason is unknown; original failure evidence stays.</p></details></section>';
}
export function reservationLabel(value){return Number.isFinite(value)&&value>=0?'$'+(Math.ceil(value*1e6)/1e6).toFixed(6):'Unavailable';}
export function renderRecoveryConfirmation(preview,esc,{busy=false,error=''}={}){
 return '<section class="detail-section recovery-confirmation"><h2>Repair design?</h2>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+'<p>One paid correction of the same approved task and source context. No automatic retry.</p><p class="approval-cost">Reserve up to '+esc(reservationLabel(preview?.reservationUsd))+'. The recorded test allowance remains enforced.</p><p>Original evidence stays. Downstream work will not run automatically; continuing needs separate review and approval. No generated code or tests run.</p><div class="approval-actions"><button data-action="cancel-editor">Cancel</button><button data-action="approve-recovery"'+(busy?' disabled':'')+'>Repair design</button></div></section>';
}
