export function goalTransitionMessage(s){
 if(s.goalTransitionSubmission?.state==='submitting')return 'Saving the requested goal change…';
 if(s.goalTransitionCancel?.state==='unconfirmed')return 'Goal cancellation is unconfirmed. Check saved status; it will not be repeated automatically.';
 if(s.goalTransitionSubmission?.state==='unconfirmed'||s.goalTransitionClaim?.state==='unconfirmed')return 'Goal update admission is unconfirmed. Check saved status; it will not be resent automatically.';
 const g=s.goalTransition;if(!g||g.state==='closed')return s.goalTransitionNotice||'';
 if(g.state==='waiting')return g.original?.status==='running'?'Goal change saved. The current work wave will finish before remaining old work stops.':'Goal change saved. Waiting for the previous run and its accounting to be confirmed.';
 if(g.state==='planning')return g.planner?.status==='running'?'Replanning the requested goal change. The previous plan remains active until the new proposal is reviewed.':'Goal replan is pending or unconfirmed. No request will be automatically repeated.';
 if(g.state==='proposed')return 'Goal update ready for review. No new work has started.';
 if(g.state==='needs_attention')return 'The goal update needs attention. The previous plan and history remain unchanged; no automatic retry was made.';
 return 'Goal update status is unconfirmed.';
}
export function goalTransitionBlocksRun(s){return !!s.goalTransitionSubmission||!!s.goalTransitionClaim||!!s.goalTransitionCancel||!!(s.goalTransition&&s.goalTransition.state!=='closed');}
// UI orchestration only. The server owns queue order, run settlement and
// single-use claims; this client never executes generated code or auto-retries
// an uncertain POST.
export function createGoalTransitionClient({fetcher=fetch,csrf,valid,canDispatch,dispatch,onChange=()=>{},newId=()=> 'goal_'+crypto.randomUUID().replaceAll('-','')}={}){
 const syncing=new Set();
 const changed=s=>onChange(s);
 async function post(path,value){const r=await fetcher(path,{method:'POST',headers:{'Content-Type':'application/json','X-MusePilot-CSRF':csrf()},body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});let body;try{body=await r.json();}catch{throw Error('goal_request_unconfirmed');}if(!r.ok)throw Object.assign(Error(body.error||'goal_request_rejected'),{rejected:true});return body;}
 async function enqueue(s,text){
  if(!valid(s)||s.goalTransitionSubmission)return false;
  const g=s.goalTransition?.state!=='closed'?s.goalTransition:null,runId=g?.runId||s.liveRun?.runId,base=s.pendingPlan;
  if(!runId||!base?.runId||typeof text!=='string'||!text.trim()||new TextEncoder().encode(text.trim()).length>4000)return false;
  const request={requestId:newId(),sessionId:s.id,runId,basePlanRunId:base.runId,sourceRevision:base.sourceRevision||null,text:text.trim()};
  s.goalTransitionSubmission={...request,state:'submitting'};changed(s);
  try{const value=await post('/api/goal-transition/enqueue',request);if(!valid(s)||value?.sessionId!==s.id||value.runId!==runId||value.basePlanRunId!==base.runId||!value.requests?.some(x=>x.requestId===request.requestId))throw Error('goal_request_unconfirmed');s.goalTransition=value;delete s.goalTransitionSubmission;changed(s);return true;}
  catch(error){if(error.rejected){delete s.goalTransitionSubmission;s.goalTransitionNotice=error.message;}else{s.goalTransitionSubmission.state='unconfirmed';s.goalTransitionNotice='Goal request is unconfirmed. Check saved status; no automatic retry was made.';}changed(s);return false;}
 }
 async function sync(s){
  if(!valid(s)||syncing.has(s.id))return false;syncing.add(s.id);let repeat=false;
  try{
   const r=await fetcher('/api/goal-transition?'+new URLSearchParams({sessionId:s.id}),{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('goal_status_unavailable');const data=await r.json(),g=data.transition;
   if(!valid(s))return false;if(g&&g.sessionId!==s.id)throw Error('goal_status_mismatch');
   s.goalTransition=g;
   if(s.goalTransitionSubmission&&g?.requests?.some(x=>x.requestId===s.goalTransitionSubmission.requestId)){delete s.goalTransitionSubmission;s.goalTransitionNotice='Goal change saved.';}if(g?.state==='closed'){delete s.goalTransitionCancel;delete s.goalTransitionClaim;s.goalChangeMode=false;s.goalTransitionNotice='';}
   changed(s);
   if(g?.state==='planning'&&g.planner&&g.planner.status!=='running'&&g.planner.reservedUsd===0&&g.planner.usageKnown){
    const next=await post('/api/goal-transition/reconcile',{sessionId:s.id,operationId:g.operationId});if(!valid(s)||next.sessionId!==s.id)return false;s.goalTransition=next;if(next.state!=='planning')delete s.goalTransitionClaim;changed(s);if(next.state==='waiting')repeat=true;return true;
   }
   if(!g||g.state!=='waiting'||!g.readyToPlan||s.goalTransitionSubmission||s.goalTransitionClaim||!canDispatch(s,g))return true;
   const claim={sessionId:s.id,runId:g.runId,basePlanRunId:g.basePlanRunId,latestRequestId:g.latestRequestId};
   s.goalTransitionClaim={...claim,state:'submitting'};changed(s);
   let batch;try{batch=await post('/api/goal-transition/claim',claim);}catch(error){if(error.rejected){delete s.goalTransitionClaim;s.goalTransitionNotice=error.message;}else{s.goalTransitionClaim.state='unconfirmed';s.goalTransitionNotice='Planning admission is unconfirmed. Check saved status; no automatic retry was made.';}changed(s);return false;}
   if(!valid(s)||batch.sessionId!==s.id||batch.runId!==g.runId||batch.basePlanRunId!==g.basePlanRunId||batch.throughRequestId!==g.latestRequestId||!/^goalplan_[A-Za-z0-9_-]+$/.test(batch.operationId||'')){s.goalTransitionClaim.state='unconfirmed';changed(s);return false;}
   s.goalTransitionClaim={...claim,state:'dispatching',operationId:batch.operationId};changed(s);
   try{await dispatch(s,batch);}catch{s.goalTransitionNotice='Planning outcome is unconfirmed. Check saved status; no automatic retry was made.';}
   // A recorded provider run is reconciled by the next sync. No second call is
   // made for an absent or still-running operation.
   repeat=true;return true;
  }catch{if(valid(s)){s.goalTransitionNotice='Goal status is unavailable. No automatic retry was made.';changed(s);}return false;}
  finally{syncing.delete(s.id);if(repeat&&valid(s))queueMicrotask(()=>sync(s));}
 }
 async function cancel(s){const g=s.goalTransition;if(!valid(s)||!g||!['waiting','proposed','needs_attention'].includes(g.state)||s.goalTransitionCancel)return false;s.goalTransitionCancel={state:'submitting',runId:g.runId};changed(s);try{const result=await post('/api/goal-transition/cancel',{sessionId:s.id,runId:g.runId,...(g.state==='proposed'?{proposalRunId:g.proposalRunId}:{})});if(!valid(s)||result.sessionId!==s.id||result.state!=='closed')throw Error('goal_cancel_unconfirmed');s.goalTransition=result;delete s.goalTransitionCancel;s.goalChangeMode=false;s.goalTransitionNotice='Goal change removed. Existing work may already have stopped; it was not restarted.';changed(s);return true;}catch(error){if(error.rejected){delete s.goalTransitionCancel;s.goalTransitionNotice=error.message;}else{s.goalTransitionCancel.state='unconfirmed';s.goalTransitionNotice='Goal cancellation is unconfirmed. Check saved status; it will not be repeated automatically.';}changed(s);return false;}}
 return {enqueue,sync,cancel};
}
