// An explicit model assessment is evidence, never execution/approval authority.
const own=(value,key)=>!!value&&Object.prototype.hasOwnProperty.call(value,key);
const validQuestions=value=>Array.isArray(value)&&value.length<=3&&value.every(q=>typeof q==='string'&&q.trim().length>0&&q.length<=240)&&new Set(value).size===value.length;
export function planningReadinessFields(value,{questionEnvelope=value}={}){
 if(!own(value,'planningReadiness'))return {};
 const state=value.planningReadiness,explicit=own(questionEnvelope,'clarificationQuestions'),questions=questionEnvelope?.clarificationQuestions,valid=explicit&&validQuestions(questions);
 const warning={planningReadinessWarning:'planning_readiness_unconfirmed'};
 if(state==='needs_clarification')return {planningReadiness:state,...(valid?{planningClarificationQuestions:[...questions]}:warning)};
 if(state!=='ready_for_review'||!valid||questions.length!==0)return warning;
 return {planningReadiness:state,planningClarificationQuestions:[]};
}
export function storedPlanningReadinessFields(value){
 const result=planningReadinessFields(value,{questionEnvelope:own(value,'planningClarificationQuestions')?{clarificationQuestions:value.planningClarificationQuestions}:{}});
 if(value?.planningReadinessWarning==='planning_readiness_unconfirmed'){result.planningReadinessWarning='planning_readiness_unconfirmed';if(result.planningReadiness==='ready_for_review'){delete result.planningReadiness;delete result.planningClarificationQuestions;}}
 return result;
}

export const planningReadinessEvidenceFields=storedPlanningReadinessFields;

// Presentation-only assessment from exact projected host events; never grants approval.
export function sessionPlanningReadiness(s){
 const unknown={planningReadiness:'unknown',approvalBlocked:false};
 const id=s?.pendingPlan?.runId;if(!id)return unknown;
 const all=(s.events||[]).filter(e=>e.sessionId===s.id);
 const first=all.findIndex(e=>e.runId===id&&e.type==='run.started'&&e.interactionMode==='plan');if(first<0)return unknown;
 const events=all.slice(first),runs=[];
 for(const e of events)if(e.type==='run.started'&&e.interactionMode==='plan'&&(e.runId===id||e.basePlanRunId===id||events.some(a=>a.runId===e.runId&&a.type==='message.answer'&&a.basePlanRunId===id))&&!runs.includes(e.runId))runs.push(e.runId);
 const newest=runs.at(-1);let completed=null,explicit=null;
 for(const runId of [...runs].reverse()){
  const run=events.filter(e=>e.runId===runId);
  if(run.at(-1)?.type!=='run.completed'||run.some(e=>['run.failed','run.cancelled','accounting.unknown'].includes(e.type)))continue;
  const evidence=run.filter(e=>runId===id?e.type==='plan.created':e.type==='message.answer'&&e.basePlanRunId===id).at(-1);
  const fields=planningReadinessEvidenceFields(evidence);completed||={runId,fields};if(fields.planningReadiness==='needs_clarification'||fields.planningReadiness==='ready_for_review'&&!fields.planningReadinessWarning){explicit={runId,fields};break;}
 }
 const fields=completed?.fields||{},readiness=fields.planningReadinessWarning?'unknown':fields.planningReadiness||'unknown';
 return {planningReadiness:newest===completed?.runId?readiness:'unknown',approvalBlocked:explicit?.fields.planningReadiness==='needs_clarification'};
}
