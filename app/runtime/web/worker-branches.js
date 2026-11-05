import {validateAlternatives,choosePlanAlternative} from './plan-alternatives.js';
export const MAX_WORKER_BRANCH_PROPOSALS=3;
export const WORKER_BRANCH_GUIDANCE='At this meaningful task boundary, proactively evaluate whether the observed draft suggests a genuinely different viable workflow. In this SAME response optionally include branchAlternatives: up to 3 alternatives with id alt1..alt3, taskId equal to the current task ID, title, COMPLETE canonical tasks DAG, optional complete architecture, and required rationale, predictionBasis and uncertainty. Ground predictionBasis in the actual draft or supplied context; predictions are not verified results. Preserve unchanged work IDs and instructions from approvedWorkflow. Never invent filler, measured performance or extra calls. Do not execute or apply these candidates: the approved path continues unchanged; a later explicit review is required.';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
export const workerBranchSignature=(option,architecture)=>JSON.stringify(canonical({tasks:option.tasks,architecture:option.architecture??architecture??null}));
export function validateWorkerBranches(value,tasks,architecture,taskId){
 if(!Array.isArray(value)||!value.length||value.some(a=>!a||a.taskId!==taskId||!Array.isArray(a.tasks)||['rationale','predictionBasis','uncertainty'].some(k=>typeof a[k]!=='string'||!a[k].trim())))throw Error('invalid_branch_proposal');
 return validateAlternatives(value,tasks,architecture);
}
// Synchronous receipt allocation keeps parallel worker completions within the run cap.
export function createWorkerBranchCollector(approvedPlan=null){
 let count=0;const seen=new Set();
 if(approvedPlan){
  seen.add(workerBranchSignature({tasks:approvedPlan.tasks,architecture:approvedPlan.architecture},null));
  for(const id of ['primary',...(approvedPlan.alternatives||[]).map(a=>a.id)]){const branch=choosePlanAlternative(approvedPlan,id);seen.add(workerBranchSignature(branch,null));}
 }
 return {accept(value,tasks,architecture,taskId){
  let alternatives;try{alternatives=validateWorkerBranches(value,tasks,architecture,taskId);}catch{return {code:'invalid_branch_proposal'};}
  const signatures=alternatives.map(a=>workerBranchSignature(a,architecture));
  if(signatures.some(s=>seen.has(s)))return {code:'invalid_branch_proposal'};
  if(count>=MAX_WORKER_BRANCH_PROPOSALS)return {code:'branch_proposal_limit'};
  count++;for(const s of signatures)seen.add(s);return {alternatives};
 }};
}
