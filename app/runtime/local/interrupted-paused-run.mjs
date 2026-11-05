// Close only a detached, paused run with complete recorded token receipts.
// No retry, history deletion, refund or unknown-usage reset is performed.
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
export function createInterruptedPausedRunCloser({store,activeRuns,owner,model,inputPrice,outputPrice,perCallCeiling}){
 const closing=new Set();return async input=>{
  if(!input||Object.keys(input).sort().join(',')!=='runId,sessionId'||!/^run_[A-Za-z0-9-]+$/.test(input.runId||'')||!/^[a-f0-9-]{36}$/.test(input.sessionId||''))fail('interrupted_run_input_invalid');
  if(activeRuns.size||closing.has(input.runId))fail('interrupted_run_active');closing.add(input.runId);
  try{const run=await store.getRun(input.runId,owner);if(!run||run.sessionId!==input.sessionId)fail('interrupted_run_not_owned');const rows=run.events,last=rows.at(-1);
   if(run.status==='cancelled'&&last?.code==='interrupted_paused_run_closed')return {closed:true,alreadyClosed:true,runId:run.id,sessionId:run.sessionId,chargedUsd:run.chargedUsd,usageKnown:run.usageKnown};
   const start=rows[0],ceiling=perCallCeiling();if(run.status!=='running'||last?.type!=='run.paused'||start?.interactionMode!=='agent'||start.model!==(typeof model==='function'?model():model)||!Number.isSafeInteger(start.reservedCalls)||start.reservedCalls<1||!Number.isFinite(ceiling)||Math.abs(start.budgetReservedUsd/start.reservedCalls-ceiling)>1e-8)fail('interrupted_run_not_recoverable');
   const calls=rows.filter(e=>e.type==='tool.started'&&e.name==='model.chat.completions');let chargedUsd=0;
   if(calls.length>start.reservedCalls)fail('interrupted_run_receipts_incomplete');
   for(const call of calls){const response=rows.filter(e=>e.type==='model.response'&&e.invocationId===call.invocationId),finished=rows.find(e=>e.type==='tool.completed'&&e.invocationId===call.invocationId);if(response.length!==1||!finished||!Number.isSafeInteger(response[0].promptTokens)||response[0].promptTokens<0||!Number.isSafeInteger(response[0].outputTokens)||response[0].outputTokens<0)fail('interrupted_run_receipts_incomplete');const charge=(response[0].promptTokens*inputPrice+response[0].outputTokens*outputPrice)/1e6;if(!Number.isFinite(charge)||charge<0||charge>ceiling)fail('interrupted_run_receipts_incomplete');chargedUsd+=charge;}
   if(chargedUsd>run.reservedUsd+1e-8)fail('interrupted_run_receipts_incomplete');
   const sequence=last.sequence+1;await store.appendEvent(run.id,owner,{id:run.id+':'+sequence,runId:run.id,sessionId:run.sessionId,sequence,type:'run.cancelled',time:new Date().toISOString(),code:'interrupted_paused_run_closed',execution:'not_run',tests:'not_run',summary:'Stopped paused process closed using complete recorded token receipts. Saved work remains; no request was retried.'});
   await store.settle({runId:run.id,owner,status:'cancelled',chargedUsd,usageKnown:true,startedCalls:calls.length,reason:'reported_usage_recovered_after_paused_process_exit'});
   return {closed:true,alreadyClosed:false,runId:run.id,sessionId:run.sessionId,chargedUsd,usageKnown:true};
  }finally{closing.delete(input.runId);}
 };
}
