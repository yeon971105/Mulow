// Structural executor defense. Only the owned service may authenticate retained records.
import {sha256} from './contract.mjs';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const run=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]{1,100}$/.test(x);
const fail=()=>{throw Object.assign(Error('package_continuation_invalid'),{code:'package_continuation_invalid',status:409});};
const keys=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.split(',').sort().join(',');
export function validatePackageContinuation(value,tasks,context){
 if(!keys(value,'reference,records'))fail();const r=value.reference,rows=value.records;
 if(!keys(r,'referenceId,digest,originalRunId,planRunId,planRevision,candidateRevision,candidateRecordDigest,acceptedTaskIds,remainingTaskIds,lineageRunIds')||typeof r.referenceId!=='string'||!/^continuation_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.referenceId)||!['digest','planRevision','candidateRevision','candidateRecordDigest'].every(k=>hex(r[k]))||!run(r.originalRunId)||r.planRunId!==context.planRunId||r.planRevision!==context.planRevision||r.originalRunId===context.runId)fail();
 if(!Array.isArray(r.lineageRunIds)||!r.lineageRunIds.length||r.lineageRunIds.length>24||new Set(r.lineageRunIds).size!==r.lineageRunIds.length||r.lineageRunIds.some(x=>!run(x)||x===context.runId)||r.lineageRunIds.at(-1)!==r.originalRunId)fail();
 if(!Array.isArray(rows)||!rows.length||rows.length>=tasks.length||!Array.isArray(r.acceptedTaskIds)||!Array.isArray(r.remainingTaskIds))fail();
 const byId=new Map(tasks.map(t=>[t.id,t])),done=new Set();let parent=null,lastOrigin=-1;
 for(const row of rows){if(!keys(row,'sourceRunId,taskId,taskDigest,candidateRevision,recordDigest,parentCandidateRevision')||!r.lineageRunIds.includes(row.sourceRunId)||!['taskDigest','candidateRevision','recordDigest'].every(k=>hex(row[k]))||row.parentCandidateRevision!==null&&!hex(row.parentCandidateRevision))fail();const origin=r.lineageRunIds.indexOf(row.sourceRunId);if(origin<lastOrigin)fail();lastOrigin=origin;const task=byId.get(row.taskId);if(!task||done.has(row.taskId)||row.taskDigest!==sha256(JSON.stringify(task))||!task.dependencies.every(id=>done.has(id))||parent!==null&&row.parentCandidateRevision!==parent)fail();done.add(row.taskId);parent=row.candidateRevision;}
 if(JSON.stringify(r.acceptedTaskIds)!==JSON.stringify([...done])||JSON.stringify(r.remainingTaskIds)!==JSON.stringify(tasks.filter(t=>!done.has(t.id)).map(t=>t.id))||r.candidateRevision!==rows.at(-1).candidateRevision||r.candidateRecordDigest!==rows.at(-1).recordDigest)fail();
 return structuredClone(value);
}
