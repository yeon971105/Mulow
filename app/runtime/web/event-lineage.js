import {isWorkflowTaskId} from './workflow-limits.js';
const RUN=/^run_[A-Za-z0-9-]+$/;
const HASH=/^[a-f0-9]{64}$/;
export function makeEventLineage({runId,goalRevision,architectureRevision=null,planRevision=null},data={},nodeOverride=null){
 const nodeId=isWorkflowTaskId(data.taskId)?data.taskId:isWorkflowTaskId(data.parentTaskId)?data.parentTaskId:nodeOverride;
 return {goalRevision,architectureRevision,planRevision,nodeId,attemptId:nodeId?runId+':'+nodeId:null};
}
// The plan run is the canonical goal/design version; planRevision also binds
// its exact tasks, dependencies, goal, architecture and source baseline.
export function validateEventLineage(event,previous=null){
 const v=event.lineage;if(v==null){if(previous)throw Error('Missing event lineage');return null;}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['goalRevision','architectureRevision','planRevision','nodeId','attemptId'].includes(k))||!RUN.test(v.goalRevision||'')||v.architectureRevision!==null&&v.architectureRevision!==v.goalRevision||v.planRevision!==null&&!HASH.test(v.planRevision||''))throw Error('Invalid event lineage');
 if(v.nodeId!==null&&!isWorkflowTaskId(v.nodeId)&&v.nodeId!=='project-generation')throw Error('Invalid event node');
 if(v.attemptId!==(v.nodeId?event.runId+':'+v.nodeId:null))throw Error('Invalid event attempt');
 if(event.taskId&&v.nodeId!==event.taskId||event.parentTaskId&&v.nodeId!==event.parentTaskId)throw Error('Event node mismatch');
 if(['project.generating','project.generated'].includes(event.type)&&(event.planRunId&&event.planRunId!==v.goalRevision||event.planRevision&&event.planRevision!==v.planRevision))throw Error('Project event lineage mismatch');
 if(previous&&(previous.goalRevision!==v.goalRevision||previous.architectureRevision!==v.architectureRevision||previous.planRevision&&previous.planRevision!==v.planRevision))throw Error('Event lineage changed');
 return {goalRevision:v.goalRevision,architectureRevision:v.architectureRevision,planRevision:v.planRevision,nodeId:v.nodeId,attemptId:v.attemptId};
}
