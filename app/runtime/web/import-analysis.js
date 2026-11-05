import {buildPlanningContext,inputRevision} from './planning-intake.js';
// Import is a single explicit operation. Never select historic sources implicitly.
export function sensitiveImport(text,name=''){
 return /(?:^|[\\/])(?:\.env(?:\.|$)|id_rsa|credentials(?:\.|$))/i.test(name)||/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b|(?:password|passwd|api[_ -]?key|secret|access[_ -]?token|authorization)\s*[=:]\s*["']?[^\s"']{6,}/i.test(text);
}
export function prepareImportAnalysis(s,ids){
 const sources=(s.references||[]).filter(r=>ids.includes(r.id));
 if(!sources.length||sources.some(r=>!r.text?.trim()))throw Error('No readable text for AI analysis. File retained locally; text extraction or OCR is needed.');
 if(sources.some(r=>sensitiveImport(r.text,r.name)))throw Error('Potential credentials or secrets detected. Kept local; provide a redacted design file to analyze.');
 return {sessionId:s.id,model:s.model,revision:inputRevision(s),ids:[...ids],context:buildPlanningContext(s,ids,true),goal:'Analyze the newly imported design excerpts. Explain the system architecture briefly, create a proposed architecture and workflow for our review, and ask only essential unresolved questions. Distinguish source facts from proposals. Do not execute or modify any project.'};
}
export function importAnalysisCurrent(op,s){return !!op&&op.sessionId===s.id&&op.model===s.model&&op.revision===inputRevision(s);}
export function importPlanBriefing(plan){if(!plan)return 'The analysis did not produce a reviewable design. No implementation started.';const questions=plan.clarificationQuestions||[],nodes=plan.architecture?.nodes||[];return (nodes.length?'Proposed architecture: '+nodes.slice(0,8).map(n=>n.label||n.id).join(', ')+'. ':'No validated architecture yet. ')+(questions.length?'Please clarify: '+questions.join(' '):nodes.length?'Review this draft with me. What would you like to change?':'Please refine the requirements before proceeding.')+' Workflow: '+(plan.tasks||[]).map(t=>t.title).join(' → ')+'. Nothing has been executed.';}

export function planConversationBriefing(plan){
 if(!plan)return 'I could not produce a reviewable plan. Please tell me which part to focus on.';
 if(plan.agentIteration)return plan.assistantMessage?.trim()||plan.goalSummary?.trim()||'Agent change milestones saved. Implementation has not started.';
 const korean=/[가-힣]/.test(plan.goal||''),questions=plan.clarificationQuestions||[],nodes=(plan.architecture?.nodes||[]).map(n=>n.label||n.id).slice(0,5),tasks=(plan.tasks||[]).map(t=>t.title).slice(0,4);
 let reply=typeof plan.assistantMessage==='string'?plan.assistantMessage.trim().slice(0,1200):'';
 if(!reply)reply=(korean?'우선 이렇게 구성해봤어요. ':'Here’s how I’d structure it. ')+(nodes.length?(korean?'구성은 ':'The components are ')+nodes.join(' · ')+'. ':'')+(tasks.length?(korean?'작업 순서는 ':'The workflow is ')+tasks.join(' → ')+'. ':'');
 const missing=questions.filter(q=>!reply.includes(q));if(missing.length)reply+='\n\n'+missing.map((q,i)=>(i+1)+'. '+q).join('\n');
 else if(!questions.length&&!plan.assistantMessage)reply+=korean?' 어떤 부분을 먼저 다듬을까요?':' What would you like to refine first?';
 if(plan.needsDesignDraft&&!plan.architecture)reply+='\n'+(korean?'아키텍처는 아직 유효한 초안이 없어 보완이 필요해요.':'The architecture draft still needs refinement before generation.');
 return reply;
}


function legacyPlanConversationBriefing(plan){
 const korean=/[가-힣]/.test(plan.goal||''),questions=plan.clarificationQuestions||[],nodes=(plan.architecture?.nodes||[]).map(n=>n.label||n.id).slice(0,5),tasks=(plan.tasks||[]).map(t=>t.title).slice(0,4);let reply=typeof plan.assistantMessage==='string'?plan.assistantMessage.trim().slice(0,1200):'';
 if(!reply)reply=(korean?'우선 이렇게 구성해봤어요. ':'Here’s how I’d structure it. ')+(nodes.length?(korean?'구성은 ':'The components are ')+nodes.join(' · ')+'. ':'')+(tasks.length?(korean?'작업 순서는 ':'The workflow is ')+tasks.join(' → ')+'. ':'');
 if(questions.length&&!questions.every(q=>reply.includes(q)))reply+='\n\n'+questions.join('\n');else if(!questions.length&&!plan.assistantMessage)reply+=korean?' 어떤 부분을 먼저 다듬을까요?':' What would you like to refine first?';
 if(plan.needsDesignDraft&&!plan.architecture)reply+='\n'+(korean?'아키텍처는 아직 유효한 초안이 없어 보완이 필요해요.':'The architecture draft still needs refinement before generation.');return reply;
}

/** Materialize only a completed Plan's conversation reply. Pure local migration; no dispatch. */
export function ensurePlanConversationMessage(session){
 const plan=session?.pendingPlan,runId=plan?.runId;if(!/^run_[A-Za-z0-9-]+$/.test(runId||''))return null;
 const terminal=(session.events||[]).findLast(e=>e.runId===runId&&['run.completed','run.failed','run.cancelled'].includes(e.type));
 if(terminal?.type!=='run.completed'||!['plan_ready_for_approval','plan_needs_clarification','plan_needs_design'].includes(terminal.meaning||terminal.summary))return null;
 session.messages||=[];const id=runId+':plan-conversation';
 // Restores carry historic assistantMessage as plan data, not a new model utterance.
 if(plan.restoreOf||plan.linkedRestore){
  const duplicate=session.messages.findIndex(m=>m.id===id&&m.planRunId===runId&&m.kind==='plan-briefing'&&m.role==='assistant'&&(m.text===planConversationBriefing(plan)||m.text===legacyPlanConversationBriefing(plan)));
  if(duplicate>=0)session.messages.splice(duplicate,1);
  return null;
 }
 // Applying/restoring a saved revision is an app operation, not another model answer.
 // The actual message.answer stays on its original conversation turn.
 if(plan.revisionOf?.proposalRunId||((plan.revisionOf||plan.restoreOf||plan.branchOf)&&!plan.assistantMessage?.trim())){
  const legacy=session.messages.find(m=>m.id===id&&m.kind==='plan-briefing'&&m.role==='assistant');
  if(legacy&&(legacy.text===planConversationBriefing(plan)||legacy.text===legacyPlanConversationBriefing(plan))){legacy.role='status';legacy.kind='plan-operation';legacy.text='Blueprint revision saved. Execution approval is still required; no implementation or tests ran.';return legacy;}
  return null;
 }
 const answerIds=new Set((session.events||[]).filter(e=>e.runId===runId&&e.type==='message.answer').map(e=>e.id));const actual=plan.agentIteration&&session.messages.find(m=>m.role==='assistant'&&answerIds.has(m.id));if(actual)return actual;
 const existing=session.messages.find(m=>m.role==='assistant'&&(m.id===id||m.kind==='plan-briefing'&&m.planRunId===runId));if(existing)return existing;
 if((session.conversationBranches||[]).some(branch=>(branch.messages||[]).some(m=>m.role==='assistant'&&(m.id===id||m.kind==='plan-briefing'&&m.planRunId===runId))))return null;
 const text=planConversationBriefing(plan),last=session.messages.at(-1);
 // Only the exact trailing legacy formatter output is adopted. Never remove user or ordinary assistant content.
 const message=last?.role==='assistant'&&!last.id&&!last.kind&&(last.text===text||last.text===legacyPlanConversationBriefing(plan))?last:{role:'assistant',text};
 Object.assign(message,{id,kind:'plan-briefing',planRunId:runId});if(message!==last)session.messages.push(message);return message;
}
// Closed local observations only: relay state is not proof of provider billing or receipt.
export function importConnectionNotice({health,runtimeReady=true,writerReady=true,model,configuredModel,relayAvailable=false,relayStatus,connected=false}={}){
 let reason;
 if(health!=='online')reason='The local server could not be reached. Check that Mulo is running.';
 else if(!writerReady)reason='This tab is read-only. Return to the active Mulo tab before analyzing.';
 else if(!runtimeReady)reason='The local runtime version does not match this app. Open the matching Mulo version.';
 else if(configuredModel&&model!==configuredModel)reason='The selected model does not match the connected runtime. Select the connected model first.';
 else if(model==='spark'&&relayAvailable&&!connected)reason=relayStatus==='connecting'?'Approve the Muse Spark connection in its private tab.':relayStatus==='blocked'?'Allow the Muse Spark connection popup, then connect.':'Muse Spark is not connected or its connection is no longer available. Choose Connect Muse Spark.';
 else if(!connected)reason='The selected provider is not connected. Check its connection before analyzing.';
 else reason='Analysis is not ready. Check the current connection status.';
 return 'File kept locally. '+reason+' Then choose Analyze imported file. Nothing was sent; no automatic retry.';
}
