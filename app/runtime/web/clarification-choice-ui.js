import {safePlanDiagnostic} from './plan-diagnostics.js';
import {validateClarificationChoices} from './clarification-choices.js';
let selectionSequence=0;
export function clarificationChoiceContext(s,revision){
 const p=s?.pendingPlan,q=p?.clarificationQuestions;
 if(!p?.runId||p.stale||!Array.isArray(q)||!q.length||q.length>3||q.some(x=>typeof x!=='string'||!x.trim()||x.length>240))return null;
 if((s.messages||[]).some(m=>m.role==='user'&&m.clarificationFor===p.runId))return null;
 let rows;try{rows=validateClarificationChoices(p.clarificationChoices,q)||[];}catch{return null;}const choices=new Map(rows.map(c=>[c.questionIndex,[...c.options].sort((a,b)=>a.id.localeCompare(b.id))]));
 const tail=(s.messages||[]).at(-1);return {key:JSON.stringify([s.id,p.runId,s.model,revision,q,p.clarificationChoices,(s.messages||[]).length,tail?.id,tail?.text]),sessionId:s.id,runId:p.runId,questions:[...q],choices};
}
export function newClarificationSelection(context){return {token:'clarification_'+(++selectionSequence),key:context.key,index:0,answers:[],selectedId:null,custom:false,text:'',busy:false,dismissed:false,error:''};}
function assertSelection(context,state){
 if(!context||!state||state.key!==context.key||state.busy||state.dismissed||state.index>=context.questions.length)throw Error('These questions changed.');
}
export function selectClarificationOption(context,state,id){
 assertSelection(context,state);
 if(id!=='custom'&&!context.choices.get(state.index)?.some(o=>o.id===id))throw Error('Choose an available answer.');
 state.selectedId=id;state.custom=id==='custom';state.error='';
}
export function dismissClarificationQuestion(context,state){
 assertSelection(context,state);state.dismissed=true;state.token='clarification_'+(++selectionSequence);
}
export function chooseClarificationAnswer(context,state,id=state?.selectedId,text=state?.text||''){
 assertSelection(context,state);
 const value=id==='custom'?text.trim():context.choices.get(state.index)?.find(o=>o.id===id)?.label;
 if(typeof value!=='string'||!value||value.length>600)throw Error('Enter an answer of 1–600 characters.');
 state.answers.push(value);state.index++;state.token='clarification_'+(++selectionSequence);state.selectedId=null;state.custom=false;state.text='';state.error='';
 if(state.index<context.questions.length)return null;
 state.busy=true;return context.questions.map((q,i)=>q+'\n'+state.answers[i]).join('\n\n');
}
export function renderClarificationChoices(context,state,esc,{disabled=false}={}){
 if(!context||state.key!==context.key||state.dismissed)return '';
 const i=Math.min(state.index,context.questions.length-1),options=context.choices.get(i)||[],off=disabled||state.busy,attrs=' data-clarification-key="'+esc(state.token)+'"',hasAnswer=state.selectedId==='custom'?Boolean(state.text.trim())&&state.text.trim().length<=600:options.some(o=>o.id===state.selectedId);
 return '<section class="clarification-choices" aria-label="Question" tabindex="-1"><header class="clarification-question-header"><strong>Question</strong>'+(context.questions.length>1?'<small>'+(i+1)+' of '+context.questions.length+'</small>':'')+'<button type="button" data-clarification-dismiss'+attrs+' aria-label="Close question"'+(state.busy?' disabled':'')+'>×</button></header><h3>'+esc(context.questions[i])+'</h3><div class="clarification-options" role="group" aria-label="Suggested answers">'+options.map(o=>'<button type="button" data-clarification-choice="'+o.id+'"'+attrs+' aria-pressed="'+(state.selectedId===o.id)+'"'+(off?' disabled':'')+'><b>'+o.id+'</b><span>'+esc(o.label)+'</span></button>').join('')+'</div><div class="clarification-response"><input aria-label="Write your own response" placeholder="Or write your own response" data-clarification-input data-clarification-token="'+esc(state.token)+'" maxlength="600" value="'+esc(state.text)+'"'+(off?' disabled':'')+'><div class="clarification-question-actions"><button type="button" data-clarification-dismiss'+attrs+(state.busy?' disabled':'')+'>Skip</button><button type="button" data-clarification-send'+attrs+(off||!hasAnswer?' disabled':'')+'>Send</button></div></div>'+(state.error?'<p role="alert">'+esc(state.error)+'</p>':'')+(state.busy?'<small role="status">Updating plan…</small>':'<small class="clarification-local-note">Select an answer, then Send. Skipping leaves this decision unresolved.</small>')+'</section>';
}

export function clarificationFailureNotice(s,runId,{cancelled=false,transport=false}={},describe){
 const event=typeof runId==='string'&&runId?(s.events||[]).findLast(e=>e.type==='run.failed'&&e.runId===runId&&e.sessionId===s.id):null;
 let reason='The plan update could not be completed.';
 if(event?.code==='invalid_goal_metadata')reason=event.details?.field==='goalSummary'?'Planner goal summary failed validation.':event.details?.field==='goalTitle'?'Planner goal title failed validation.':'Planner goal metadata failed validation.';
 else if(event&&['invalid_plan','invalid_plan_dependencies','cyclic_plan','invalid_clarification_choices','invalid_clarification_questions','proposal_node_identity_changed','proposal_task_identity_changed'].includes(event.code)&&typeof describe==='function')reason=describe(event.code,safePlanDiagnostic(event.details)||undefined).reason;
 else if(cancelled)reason='The plan update stopped.';
 else if(transport)reason='The request outcome is unconfirmed. Check saved run status before sending again.';
 return reason+' Your submitted answer is saved in this conversation. Edit that message if you want to change it. No automatic retry or approval.';
}
