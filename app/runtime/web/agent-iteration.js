// Schema validation is not execution authority. The local host authenticates
// this reference against its immutable owned Agent receipt before any Build.
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const run=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]{1,100}$/.test(x);
export function safeAgentIterationFields(value){
 if(value?.agentIteration===undefined)return {};
 const a=value.agentIteration,b=a?.basis,fail=()=>{throw Error('agent_iteration_metadata_invalid');};
 if(!exact(a,['version','iterationRunId','basis','requestDigest','parentPlanDigest','parentArchitectureDigest'])||a.version!==1||!run(a.iterationRunId)||![a.requestDigest,a.parentPlanDigest,a.parentArchitectureDigest].every(hex)||!exact(b,['sessionId','parentPlanRunId','documentRevision','documentDigest','sourceRevision','recipientDigest'])||!/^[-a-f0-9]{36}$/.test(b.sessionId||'')||!run(b.parentPlanRunId)||!/^plandoc_[A-Za-z0-9-]{1,100}$/.test(b.documentRevision||'')||![b.documentDigest,b.sourceRevision,b.recipientDigest].every(hex))fail();
 return {agentIteration:structuredClone(a)};
}
export function agentIterationMatchesDocument(plan,current){try{const a=safeAgentIterationFields(plan).agentIteration;return !!a&&!!current&&a.basis.documentRevision===current.revisionId&&a.basis.documentDigest===current.documentDigest;}catch{return false;}}

export function safeAgentIterationRequestFields(event){
 if(event?.agentIterationRequest===undefined)return {};
 const b=event.agentIterationRequest;
 if(event.type!=='run.started'||event.interactionMode!=='plan'||event.conversation===true||!exact(b,['sessionId','parentPlanRunId','documentRevision','documentDigest','sourceRevision','recipientDigest'])||b.sessionId!==event.sessionId||!run(b.parentPlanRunId)||b.parentPlanRunId===event.runId||!/^plandoc_[A-Za-z0-9-]{1,100}$/.test(b.documentRevision||'')||![b.documentDigest,b.sourceRevision,b.recipientDigest].every(hex))throw Error('agent_iteration_request_invalid');
 return {agentIterationRequest:structuredClone(b)};
}
