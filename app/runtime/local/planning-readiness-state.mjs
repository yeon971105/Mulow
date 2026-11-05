import {storedPlanningReadinessFields} from '../web/planning-readiness.js';
// Read only owned immutable host events. Model prose is never approval authority.
export function currentPlanningReadiness({store,owner,sessionId,planRunId}){
 const unknown={planningReadiness:'unknown',approvalBlocked:false,turnRunId:null,assessmentRunId:null};if(!planRunId)return unknown;
 const base=store.db.prepare('SELECT rowid FROM runs WHERE id=? AND owner=? AND session_id=?').get(planRunId,owner,sessionId);if(!base)return unknown;
 const rows=store.db.prepare('SELECT rowid,* FROM runs WHERE owner=? AND session_id=? AND rowid>=? ORDER BY rowid DESC').all(owner,sessionId,base.rowid);let newest=null,completed=null,explicit=null;
 for(const row of rows){const events=store.db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(row.id).map(x=>JSON.parse(x.payload));const start=events.find(e=>e.type==='run.started'),plan=events.find(e=>e.type==='plan.created'&&e.interactionMode==='plan'),answer=events.filter(e=>e.type==='message.answer'&&e.basePlanRunId===planRunId).at(-1);if(row.id!==planRunId&&!(start?.interactionMode==='plan'&&start.basePlanRunId===planRunId)&&!answer)continue;
  if(!newest)newest=row;if(row.status==='completed'&&row.usage_known===1&&row.reserved===0&&events.at(-1)?.type==='run.completed'){const evidence=row.id===planRunId?plan:answer;const item={row,fields:storedPlanningReadinessFields(evidence)};if(!completed)completed=item;if(item.fields.planningReadiness==='needs_clarification'||item.fields.planningReadiness==='ready_for_review'&&!item.fields.planningReadinessWarning){explicit=item;break;}}
 }
 if(!newest)return unknown;const state=completed?.fields.planningReadinessWarning?'unknown':completed?.fields.planningReadiness||'unknown';return {planningReadiness:newest.id===completed?.row.id?state:'unknown',approvalBlocked:explicit?.fields.planningReadiness==='needs_clarification',turnRunId:newest.id,assessmentRunId:completed?.row.id||null,...(completed?.fields.planningReadinessWarning?{planningReadinessWarning:completed.fields.planningReadinessWarning}:{})};
}
export function cleanPlanningReadiness(plan){const {planningReadiness,planningClarificationQuestions,planningReadinessWarning,...rest}=plan;return {...rest,...storedPlanningReadinessFields(plan)};}
