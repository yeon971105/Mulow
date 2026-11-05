import {assessPlanArtifact} from './planning-artifact.js';
import {sessionPlanningReadiness} from './planning-readiness.js';
import {generationAssessment} from './generation-strategy.js';
// Presentation intent only. Never grants approval or starts provider work.
export function isStandalonePlanApproval(text){return typeof text==='string'&&/^(?:approve(?: (?:the )?plan)?|승인|계획 승인)[.!]?$/i.test(text.trim());}
export function latestPlanApprovalMessageIndex(s){const p=s?.pendingPlan;if(!p?.runId||p.remoteStudy)return -1;return (s.messages||[]).findLastIndex(m=>m.role==='assistant'&&(m.planRunId===p.runId||m.planConversationRunId&&m.planConversationRunId===p.revisionOf?.proposalRunId));}
export function createPlanMessageApproval(s,index,inputRevision,sourceIdentity){if(index<0||index!==latestPlanApprovalMessageIndex(s))return null;return {sessionId:s.id,planRunId:s.pendingPlan.runId,index,messageId:s.messages[index].id||null,messageSnapshot:JSON.stringify(s.messages[index]),planSnapshot:JSON.stringify(s.pendingPlan),model:s.model,inputRevision,sourceIdentity};}
export function planMessageApprovalCurrent(b,s,inputRevision,sourceIdentity){return !!b&&JSON.stringify(b)===JSON.stringify(createPlanMessageApproval(s,b.index,inputRevision,sourceIdentity));}
// Only exact, completed current-plan evidence can invite approval. This is not authority.
export function currentPlanningReadiness(s){return sessionPlanningReadiness(s).planningReadiness;}
export function currentPlanHasBuildAttempt(s){const id=s?.pendingPlan?.runId;if(!id||!s.id)return false;const events=s.events||[];return events.some(e=>e.type==='project.generating'&&e.sessionId===s.id&&e.planRunId===id&&typeof e.runId==='string'&&events.some(start=>start.type==='run.started'&&start.sessionId===s.id&&start.runId===e.runId&&start.interactionMode==='agent'));}
export function proactivePlanApprovalReady(s,status){
 if(currentPlanHasBuildAttempt(s)||!assessPlanArtifact(s?.pendingPlan).ready||currentPlanningReadiness(s)!=='ready_for_review'||s.pendingPlan?.stale||s.pendingPlan?.clarificationQuestions?.length||s.planProposal||['waiting','applying'].includes(s.planRefinement?.state)||s.liveRun?.status==='running')return false;
 try{generationAssessment(s.pendingPlan,status);return true;}catch{return false;}
}
export function renderPlanMessageApproval(binding,approved,esc,session=null,status=null){
 if(!binding||session?.id!==binding.sessionId||session.pendingPlan?.runId!==binding.planRunId||!proactivePlanApprovalReady(session,status))return '';
 return '<div class="plan-message-approval"><div><button type="button" data-plan-message-action="approve" data-plan-message-session="'+esc(binding.sessionId)+'" data-plan-message-run="'+esc(binding.planRunId)+'" data-plan-message-index="'+binding.index+'">'+(approved?'Review approval':'Approve plan')+'</button><button type="button" data-plan-message-action="refine" data-plan-message-session="'+esc(binding.sessionId)+'" data-plan-message-run="'+esc(binding.planRunId)+'" data-plan-message-index="'+binding.index+'">Refine</button></div></div>';
}
