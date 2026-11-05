import {createHash,randomUUID} from 'node:crypto';
import {agentIterationBasis,assertAgentIterationBasis,assembleAgentIteration,agentIterationMessages} from '../backend/agent-iteration-contract.mjs';
import {prepareNodeRequest,modelJson} from '../backend/orchestrator.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
// context() is supplied by the local host. It reads the owned current source,
// original document and recipient policy; none is accepted from model output.
export function createAgentIterationService({store,owner,context,config,fetcher=fetch,validateParent=()=>true,now=Date.now}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS agent_iterations(run_id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL)');
 function read(id,sessionId){const row=db.prepare('SELECT * FROM agent_iterations WHERE run_id=? AND owner=? AND session_id=?').get(id,owner,sessionId);if(!row)fail('agent_iteration_not_owned');const p=JSON.parse(row.payload);if(hash(p)!==row.digest)fail('agent_iteration_integrity');return p;}
 function storedPlan(plan,sessionId){
  const id=plan?.agentIteration?.iterationRunId,p=read(id,sessionId),run=db.prepare('SELECT status,reserved,usage_known FROM runs WHERE id=? AND owner=? AND session_id=?').get(id,owner,sessionId);
  if(run?.status!=='completed'||run.reserved!==0||run.usage_known!==1||Object.keys(p.plan).some(k=>JSON.stringify(plan[k])!==JSON.stringify(p.plan[k])))fail('agent_iteration_unconfirmed');
  return p;
 }
 function assertPlan(plan,sessionId,{runId=null,operationId=null}={}){
  const p=storedPlan(plan,sessionId),c=context({sessionId,parentPlanRunId:p.brief.basis.parentPlanRunId,ignoreRunId:runId,ignoreOperationId:operationId});
  if(!c||c.blocked)fail('agent_iteration_context_unavailable');
  const current=agentIterationBasis(c.basis),before=p.brief.basis;
  if(['sessionId','parentPlanRunId','documentRevision','documentDigest','recipientDigest'].some(k=>current[k]!==before[k]))fail('agent_iteration_basis_changed');
  const destination=plan.runId||p.plan.agentIteration.iterationRunId;
  if(c.currentPlanRunId!==destination)fail('agent_iteration_plan_changed');
  if(current.sourceRevision!==before.sourceRevision){
   const n=c.native,r=n?.status==='known'&&db.prepare('SELECT p.plan_run_id,r.status,r.reserved,r.usage_known FROM project_bundles p JOIN runs r ON r.id=p.run_id WHERE p.run_id=? AND p.revision=? AND p.owner=? AND p.session_id=? AND r.owner=p.owner AND r.session_id=p.session_id').get(n.runId,n.revision,owner,sessionId);
   const restored=r&&r.plan_run_id!==destination&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='linked_restores'").get()&&db.prepare("SELECT 1 FROM linked_restores WHERE owner=? AND session_id=? AND new_plan_id=? AND target_run_id=? AND target_revision=? AND status='completed'").get(owner,sessionId,destination,n.runId,n.revision);
   if(!r||(r.plan_run_id!==destination&&!restored)||r.status!=='completed'||r.reserved!==0||r.usage_known!==1)fail('agent_iteration_source_changed');
  }
  return true;
 }
 return {assertPlan,verifyStoredPlan(plan,sessionId){storedPlan(plan,sessionId);return true;},has:plan=>!!plan?.agentIteration,
  async run(input,caller){
   if(caller!==owner||!exact(input,['sessionId','parentPlanRunId','sourceRevision','requestText','operationId'])||typeof input.requestText!=='string'||!input.requestText.trim()||input.requestText.length>6000||!/^[-A-Za-z0-9_]{8,100}$/.test(input.operationId||''))fail('agent_iteration_request_invalid');
   const c=context({sessionId:input.sessionId,parentPlanRunId:input.parentPlanRunId,ignoreOperationId:input.operationId});
   if(!c||c.blocked||c.currentPlanRunId!==input.parentPlanRunId||c.parentPlan?.runId!==input.parentPlanRunId)fail('agent_iteration_parent_changed');
   const basis=agentIterationBasis(c.basis);if(basis.sessionId!==input.sessionId||basis.parentPlanRunId!==input.parentPlanRunId)fail('agent_iteration_parent_changed');if(basis.sourceRevision!==input.sourceRevision||c.source?.revision!==basis.sourceRevision||!Array.isArray(c.source.files)||!c.source.files.length)fail('agent_iteration_source_changed');
   if(validateParent(c.parentPlan,input.sessionId,{operationId:input.operationId})!==true)fail('agent_iteration_parent_unconfirmed');const model=config();if(c.providerIdentity?.provider!=='baseten'||c.providerIdentity?.model!==model.model||c.providerIdentity?.mode!=='live')fail('agent_iteration_recipient_unavailable');const messages=agentIterationMessages({parentPlan:c.parentPlan,source:c.source,request:input.requestText,reviewedPlanDocument:c.document?.document||c.parentPlan.planDocument||null}),prepared=await prepareNodeRequest(model,messages,basis.sourceRevision,'agent_iteration_tool'),body=JSON.parse(prepared.bodyText);
   if(Buffer.byteLength(JSON.stringify({messages:body.messages,tools:body.tools,tool_choice:body.tool_choice}))>Math.min(model.inputBytes,80000)||prepared.evidence.bodyBytes>96000)fail('agent_iteration_input_limit');
   const runId='run_'+randomUUID(),reservation=await store.reserve({runId,operationId:input.operationId,owner,sessionId:input.sessionId,model:model.model,reservationUsd:2*model.maxCallUsd,budgetUsd:model.budget});if(reservation?.accepted!==true)fail('agent_iteration_budget_or_active_run');
   const controller=new AbortController(),accounting={started:0,accounted:0,reported:0,spent:0};let cancelled=false,seq=0;
   const current=()=>{if(controller.signal.aborted)fail('run_cancelled');const next=context({sessionId:input.sessionId,parentPlanRunId:input.parentPlanRunId,ignoreRunId:runId,ignoreOperationId:input.operationId});if(!next||next.blocked||next.currentPlanRunId!==input.parentPlanRunId)fail('agent_iteration_parent_changed');assertAgentIterationBasis(basis,next.basis);};
   const stream=new ReadableStream({start(out){
    const emit=async(type,fields={})=>{const e={...fields,type,id:runId+':'+(++seq),runId,sessionId:input.sessionId,sequence:seq,time:new Date(now()).toISOString()};await store.appendEvent(runId,owner,e);if(!cancelled)out.enqueue(new TextEncoder().encode(JSON.stringify(e)+'\n'));};
    (async()=>{let status='failed';try{
     await emit('run.started',{interactionMode:'plan',agentIterationRequest:basis,model:model.model,budgetReservedUsd:2*model.maxCallUsd,reservedCalls:2,providerIdentity:c.providerIdentity});
     let result,brief,wire=prepared,wireMessages=messages;
     for(let attempt=0;attempt<2;attempt++){
      current();const invocation={invocationId:runId+':invocation:'+(attempt+1),name:'model.chat.completions',taskId:null,agentId:runId+':planner'};
      await emit('tool.started',{...invocation,requestEvidence:wire.evidence,inputSummary:attempt?'Correct the rejected Agent change field once against the unchanged request and source.':'Assess the requested edits against this exact existing source and Architecture. Preserve the reviewed Plan.'});
      try{
       result=await modelJson(model,wireMessages,fetcher,controller.signal,accounting,meta=>emit('model.response',{...invocation,...meta}),'agent_iteration_tool',wire,current);
       current();brief=assembleAgentIteration({basis,parentPlan:c.parentPlan,request:input.requestText,result});if(brief.tasks.length>6)fail('agent_iteration_milestone_limit');
       await emit('tool.completed',invocation);break;
      }catch(error){
       await emit('tool.failed',{...invocation,code:error.code||'agent_iteration_failed',details:error.details?{field:'agent_iteration',reason:error.details.reason}:null});
       // Only a parsed, known-accounted proposal may receive one contract correction.
       // Transport failures, uncertain usage and changed authority never retry.
       if(attempt!==0||!result||error.code!=='agent_iteration_invalid'||accounting.started!==1||accounting.accounted!==1||accounting.reported!==1)throw error;
       current();wireMessages=[...messages,{role:'user',content:JSON.stringify({correction:'Correct only the rejected proposal contract. Use exact literal requestQuote text, real Architecture component IDs, no cycles, and only actually requested capabilities. The original Plan and source remain unchanged.',reason:error.details?.reason||'submission',rejectedProposal:result})}];
       wire=await prepareNodeRequest(model,wireMessages,basis.sourceRevision,'agent_iteration_tool');const correction=JSON.parse(wire.bodyText);if(Buffer.byteLength(JSON.stringify({messages:correction.messages,tools:correction.tools,tool_choice:correction.tool_choice}))>Math.min(model.inputBytes,80000)||wire.evidence.bodyBytes>96000)fail('agent_iteration_input_limit');
      }
     }
     current();if(!brief||accounting.started<1||accounting.started>2||accounting.accounted!==accounting.started||accounting.reported!==accounting.started)fail('agent_iteration_usage_unconfirmed');
     const reference={version:1,iterationRunId:runId,basis,requestDigest:brief.requestDigest,parentPlanDigest:brief.parentPlanDigest,parentArchitectureDigest:brief.parentArchitectureDigest};
     const plan={goal:input.requestText,originalGoal:c.parentPlan.originalGoal||c.parentPlan.goal,originalGoalRunId:c.parentPlan.originalGoalRunId||c.parentPlan.runId,goalTitle:brief.title,goalSummary:brief.summary,tasks:brief.tasks,architecture:brief.architecture,requiredCapabilities:brief.requiredCapabilities,clarificationQuestions:[],sourceRevision:c.parentPlan.sourceRevision||null,agentIteration:reference};
     const payload={plan,brief,sourceDigest:hash(c.source),requestEvidence:prepared.evidence};db.prepare('INSERT INTO agent_iterations VALUES(?,?,?,?,?)').run(runId,owner,input.sessionId,JSON.stringify(payload),hash(payload));
     await emit('plan.created',{...plan,interactionMode:'plan'});
     await emit('message.answer',{text:brief.summary,interactionMode:'agent'});
     status='completed';await emit('run.completed',{meaning:'plan_ready_for_approval',execution:'not_run',tests:'not_run',verified:false});
    }catch(error){status=cancelled||controller.signal.aborted?'cancelled':'failed';await emit(status==='cancelled'?'run.cancelled':'run.failed',{code:status==='cancelled'?'run_cancelled':error.code||'agent_iteration_failed',details:error.details?{field:'agent_iteration',reason:error.details.reason}:null,execution:'not_run',tests:'not_run',verified:false}).catch(()=>{});}
    finally{controller.abort();const uncertain=Math.max(0,accounting.started-accounting.accounted);try{await store.settle({runId,owner,status,chargedUsd:accounting.spent+uncertain*model.maxCallUsd,startedCalls:accounting.started,usageKnown:uncertain===0&&accounting.reported===accounting.started,reason:uncertain?'conservative_unknown_call_charge':'reported_usage'});}catch{await emit('accounting.unknown',{reservationRetained:true}).catch(()=>{});}if(!cancelled)out.close();}
    })();
   },cancel(){cancelled=true;controller.abort();}});
   return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'}});
  }
 };
}
