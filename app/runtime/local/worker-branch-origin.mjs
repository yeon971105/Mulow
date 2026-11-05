import {createHash} from 'node:crypto';
import {validateWorkerBranches} from '../web/worker-branches.js';
export async function resolveWorkerBranchOrigin({store,owner,input,saved,currentLineage}){
 const fail=()=>{throw Error('branch_proposal_binding_mismatch');};
 const run=await store.getRun(input.proposalRunId,owner),event=run?.events.find(e=>e.sequence===input.proposalSequence&&e.type==='plan.branches_proposed');
 const start=run?.events.find(e=>e.type==='project.generating'),worker=run?.events.find(e=>e.type==='plan.created'&&e.interactionMode==='agent'),generated=run?.events.find(e=>e.type==='project.generated');
 if(!run||run.sessionId!==input.sessionId||!['completed','failed','cancelled'].includes(run.status)||!run.usageKnown||run.reservedUsd!==0||!event||!start||!worker||event.id!==run.id+':'+input.proposalSequence||event.runId!==run.id||(event.sessionId!==undefined&&event.sessionId!==input.sessionId))fail();
 const digest=createHash('sha256').update(JSON.stringify({planRunId:input.basePlanRunId,planChoice:null,tasks:saved.tasks,architecture:saved.architecture||null,goal:saved.goal,sourceRevision:saved.sourceRevision||null})).digest('hex');
 if(start.strategy!=='staged-artifacts-v1'||start.planRunId!==input.basePlanRunId||start.planRevision!==digest||event.planRunId!==input.basePlanRunId||event.planRevision!==digest||event.baseSourceRevision!==start.baseSourceRevision||event.lineage?.goalRevision!==input.basePlanRunId||event.lineage?.planRevision!==digest||event.lineage?.nodeId!==event.taskId||event.agentId!==run.id+':worker:'+event.taskId||JSON.stringify(worker.tasks)!==JSON.stringify(saved.tasks)||JSON.stringify(worker.architecture||null)!==JSON.stringify(saved.architecture||null)||worker.goal!==saved.goal)fail();
 const earlier=run.events.filter(e=>e.sequence<event.sequence&&e.taskId===event.taskId);
 if(!earlier.some(e=>e.type==='artifacts.created'&&e.draft===true)||!earlier.some(e=>e.type==='validation.completed'&&e.checks?.includes('artifact_schema')))fail();
 const alternatives=validateWorkerBranches(event.alternatives,saved.tasks,saved.architecture||null,event.taskId);
 const source=()=>{const current=currentLineage({sessionId:input.sessionId,owner});if(generated){if(run.status!=='completed'||generated.planRevision!==digest||current.status!=='known'||current.runId!==run.id||current.revision!==generated.revision||current.planRunId!==input.basePlanRunId)throw Error('branch_proposal_source_changed');}else if(start.baseSourceRevision===null){if(current.status!=='empty')throw Error('branch_proposal_source_changed');}else if(current.status!=='known'||current.revision!==start.baseSourceRevision)throw Error('branch_proposal_source_changed');return current;};
 source();return {alternatives,assertSource:source,provenance:{proposalRunId:run.id,proposalSequence:event.sequence,planRevision:digest}};
}
