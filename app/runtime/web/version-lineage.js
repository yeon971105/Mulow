// IDs come from saved plan and project events, never from matching display numbers.
const runId=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]+$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const sourceMatchesPlan=(bundle,id)=>!!id&&(bundle?.planRunId===id||runId(id)&&Array.isArray(bundle?.restoredPlanRunIds)&&bundle.restoredPlanRunIds.includes(id));
export function sourceStateFor(bundle,current){
 if(!bundle)return 'none';
 if(current?.status==='empty')return 'different';
 if(current?.status!=='known'||!runId(current.runId)||!hash(current.revision))return 'unknown';
 return current.runId===bundle.runId&&current.revision===bundle.revision?'current':'different';
}
export function versionLineage(s,current){
 const seenIds=new Set(),versions=(s.designVersions||[]).filter(v=>runId(v?.id)&&v.graph&&!seenIds.has(v.id)&&seenIds.add(v.id));
 const selected=versions.find(v=>v.id===s.pendingPlan?.runId)||versions.find(v=>v.id===s.architecture?.designRunId)||null;
 const id=selected?.id||null,active=s.pendingPlan?.runId||null;
 const candidates=(s.projectBundles||[]).filter(b=>runId(b?.runId)&&hash(b.revision));
 // Prefer source actually generated for this plan over an equivalent restore.
 const bundle=id?(candidates.findLast(b=>b.planRunId===id)||candidates.findLast(b=>sourceMatchesPlan(b,id))):null;
 const running=s.runtimeRecord,owned=running?.binding?.sessionId===s.id&&runId(running?.binding?.runId)&&hash(running?.binding?.revision);
 const matches=!!(owned&&bundle&&running.binding.runId===bundle.runId&&running.binding.revision===bundle.revision);
 return {designId:id,designNumber:selected?versions.indexOf(selected)+1:null,inspection:!!(id&&active&&id!==active),activePlanId:active,bundle:bundle||null,sourceState:sourceStateFor(bundle,current),runtime:owned?running:null,runtimeMatches:matches};
}
export function mergeProjectLineage(s,items){
 if(!Array.isArray(items)||items.length>200)return false;let changed=false;
 for(const x of items){if(!runId(x?.runId)||!hash(x?.revision)||!runId(x?.planRunId)||!hash(x?.planRevision))continue;
  const b=(s.projectBundles||[]).find(p=>p.runId===x.runId&&p.revision===x.revision);if(!b)continue;
  if(b.planRunId!==x.planRunId||b.planRevision!==x.planRevision){b.planRunId=x.planRunId;b.planRevision=x.planRevision;changed=true;}
  const aliases=Array.isArray(x.restoredPlanRunIds)&&x.restoredPlanRunIds.length<=200&&x.restoredPlanRunIds.every(runId)?[...new Set(x.restoredPlanRunIds)]:[];
  if(JSON.stringify(b.restoredPlanRunIds||[])!==JSON.stringify(aliases)){if(aliases.length)b.restoredPlanRunIds=aliases;else delete b.restoredPlanRunIds;changed=true;}
 }
 return changed;
}
export function renderWorkflowLineage(s,esc,current){
 const l=versionLineage(s,current), warnings=[];
 if(l.inspection)warnings.push('<button type="button" data-tab="architecture">Viewing history · active plan unchanged</button>');
 if(l.sourceState==='different')warnings.push('<span>Source differs from current project</span>');
 else if(l.bundle&&['restore_unconfirmed','linked_restore_unconfirmed'].includes(current?.reason))warnings.push('<span>Source restore unconfirmed</span>');
 else if(l.bundle&&l.sourceState==='unknown')warnings.push('<span>Current source unconfirmed</span>');
 const live=l.runtime?.status==='ready'&&l.runtime.buildPassed===true&&Date.parse(l.runtime.expiresAt)>Date.now();
 if((live||l.runtime?.status==='starting')&&!(l.runtimeMatches&&l.sourceState==='current'))warnings.push('<button type="button" data-tab="preview">Earlier or unconfirmed preview</button>');
 if(['failed','stop_failed'].includes(l.runtime?.status))warnings.push('<button type="button" data-tab="preview">Preview error</button>');
 // Keep the container for stable layout; the tab indicator already reports normal preview status.
 return '<div class="workflow-lineage" aria-label="Architecture and preview lineage">'+warnings.join('')+'</div>';
}
export function renderWorkflowVersion(){return '';}
