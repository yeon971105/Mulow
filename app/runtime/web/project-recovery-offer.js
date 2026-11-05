import {reservationLabel} from './recovery-offer.js';
import {failureInfo} from './live.js';
export function projectRecoveryOffer(s,view,group=null){
 const runId=group?.tasks?.[0]?.runId||view.runId,events=(s.events||[]).filter(e=>e.runId===runId);
 // Staged source-assembly failure is not a worker draft failure. Legacy
 // single-stage runs have no separate assembly node and keep their old view.
 if(events.some(e=>e.type==='project.generating'&&e.strategy==='staged-artifacts-v1')&&group&&!group.projectGeneration&&!group.projectRepair)return null;
 const failure=events.findLast(e=>e.type==='run.failed'),nonJson=failure?.code==='model_output_not_json'&&events.some(e=>e.type==='tool.failed'&&e.agentId===runId+':project-author'&&e.name==='model.chat.completions'&&e.code==='model_output_not_json');
 const record=(s.runs||[]).find(r=>r.id===runId),link=record?.projectRecovery,original=link?.originalRunId||runId,repairs=(s.runs||[]).filter(r=>r.projectRecovery?.originalRunId===original);
 if(!events.some(e=>e.type==='project.generating')||!(failure?.code==='invalid_project_output'||nonJson))return null;
 if(link){if(repairs.at(-1)?.id!==runId||!(failure?.code==='invalid_project_output'||nonJson))return null;}
 else if(repairs.length)return null;
 return {failedRunId:original,reason:failureInfo(failure.code,failure.details).reason,followup:!!link,schemaGuided:Number.isInteger(link?.attempt)&&link.attempt>=2};
}
export function renderProjectRecoveryOffer(s,view,group,esc){
 const offer=projectRecoveryOffer(s,view,group);if(!offer)return '';
 const cause=offer.reason.replace(/^Project source snapshot was rejected\. /,'');
 return '<section class="progress-problem"><strong>Source format invalid</strong><p>'+esc(cause)+'</p><button data-project-recovery-preview="'+esc(offer.failedRunId)+'" aria-label="Review source regeneration">Regenerate source</button><small>Review first · paid approval before generation</small><details class="recovery-context"><summary>Scope &amp; cause</summary><p>'+(offer.schemaGuided?'Review a schema-guided attempt using the same approved scope and saved drafts.':offer.followup?'Review another attempt using the same approved scope and saved drafts.':'One regeneration of the same approved scope.')+' Each review can start at most one model call; no automatic retry. Review sends no model request. The model’s underlying reason is unknown; the validation failure is recorded.</p></details></section>';
}
export function renderProjectRecoveryConfirmation(preview,esc,{busy=false,error=''}={}){return '<section class="detail-section recovery-confirmation"><h2>Regenerate source?</h2>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+'<p>One paid call for the same approved scope'+(preview?.attempt>=3?' (schema-guided output; provider support is unverified)':'')+'. Includes the current generated source when available'+(preview?.includesTaskDrafts?' and the validated task drafts from the failed run':'')+'; local-only imports are not included; prior versions remain, along with earlier attempts. No automatic retry.</p><p class="approval-cost">Reserve up to '+esc(reservationLabel(preview?.reservationUsd))+'. The recorded test allowance remains enforced.</p><p>No generated code, build, or tests will run.</p><details><summary>Scope &amp; version details</summary><p>'+esc(preview?.goal||'Same approved project scope')+'</p><p>Current source base: '+esc(typeof preview?.baseRevision==='string'?preview.baseRevision.slice(0,12):'none')+'. The original failed baseline was not recorded. Original failure evidence remains.</p></details><div class="approval-actions"><button data-action="cancel-editor">Cancel</button><button data-action="approve-project-recovery"'+(busy?' disabled':'')+'>Regenerate</button></div></section>';}
