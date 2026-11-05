// Authority guard only: ancestry never grants remote execution approval.
export async function ordinaryPlanExecutionDenied({store,owner,sessionId,runId}) {
 const visiting=new Set(),checked=new Set();let count=0;
 async function visit(id){
  if(typeof id!=='string'||!/^run_[A-Za-z0-9-]+$/.test(id)||visiting.has(id))return true;
  if(checked.has(id))return false;
  if(++count>256)return true;
  visiting.add(id);
  const run=await store.getRun(id,owner),plan=run?.events?.find(e=>e.type==='plan.created'&&e.interactionMode==='plan');
  if(!run||run.sessionId!==sessionId||run.status!=='completed'||!plan)return true;
  if(plan.remoteStudy)return true;
  // Restore follows the selected plan, not the unrelated plan left behind.
  const links=[['restoreOf','sourcePlanRunId'],['branchOf','basePlanRunId'],['revisionOf','basePlanRunId']];
  for(const [field,key] of links){if(plan[field]!==undefined){if(!plan[field]||await visit(plan[field][key]))return true;}}
  visiting.delete(id);checked.add(id);return false;
 }
 try{return await visit(runId);}catch{return true;}
}
