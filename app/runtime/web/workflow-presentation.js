import {nodeLiveAction} from './model-output-progress.js';
import {applyRuntimeWorkflow} from './runtime-routes.js';
import {addAdaptiveWorkGroups} from './adaptive-work.js';
import {validatePackageOptionsOrigin} from './package-decision-options.js';
import {planReviewPendingLabel} from './plan-review.js';
import {projectBundleSchemaValidated} from './project-compile-status.js';
import {safeDeclarativeVerification} from './declarative-schema-verification.js';
import {safePackageProgress,safePackageBinding,safePackageAdmission} from './package-source-evidence.js';
import {safeSourceVerification} from './source-verification-receipt.js';
import {safeRunControlEvent,activePlanWorkLabel,refinementStoppedLabel} from './run-control.js';
import {sourceMatchesPlan,sourceStateFor} from './version-lineage.js';
// Dependency stages stay monotonic; parent-centered vertical fans avoid a rigid grid.
export function layoutWorkflow(work,target,depth){
 const positions={},lanes=new Map(),columnsByDepth=new Map();
 for(const node of work){const d=Math.max(0,depth.get(node.id)||0);if(!columnsByDepth.has(d))columnsByDepth.set(d,[]);columnsByDepth.get(d).push(node);}
 for(const [d,nodes] of [...columnsByDepth].sort((a,b)=>a[0]-b[0])){
  let last=-130;
  for(const [lane,node] of nodes.entries()){
   const parents=(node.deps||[]).map(id=>positions[id]).filter(Boolean),center=parents.length?parents.reduce((sum,p)=>sum+p[1],0)/parents.length:80;
   const bend=d%4===1?58:d%4===2?24:d%4===3?82:0;
   const y=Math.max(80,last+210,parents.length?center+bend:80+lane*210+bend);
   positions[node.id]=[130+d*230,y];last=y;
  }
  lanes.set(d,nodes.length);
 }
 const goalColumn=work.length?Math.max(...columnsByDepth.keys())+1:0;
 const sinks=work.filter(n=>!work.some(other=>(other.deps||[]).includes(n.id))),ys=sinks.map(n=>positions[n.id][1]);
 positions[target.id]=[130+goalColumn*230,ys.length?ys.reduce((a,b)=>a+b,0)/ys.length:80];
 return {positions,width:260+goalColumn*230,height:Math.max(80,...Object.values(positions).map(p=>p[1]))+150,columns:goalColumn+1};
}
// The default view remains legible and begins at the left; Fit is still an
// explicit option for an overview of a very large graph.
export function workflowInitialCamera(scene,viewport){
 const z=Math.min(1,Math.max(.8,(viewport.height-125)/scene.height));
 const x=scene.width*z<=viewport.width-32?0:Math.min(150,viewport.width/2)-viewport.width/2-(130-scene.width/2)*z;
 const y=scene.height*z<=viewport.height-125?0:120-viewport.height/2-((scene.anchorY||80)-scene.height/2)*z;
 return {x:x-(scene.continuationOffset||0)*z,y,z};
}
// The camera is centered on world dimensions. Compensate when a real event
// grows that world so already-visible nodes do not jump under the user.
export function compensateWorkflowGrowth(previous,next,camera){
 if(!previous||!next||previous.sessionId!==next.sessionId||(previous.cameraRunId||previous.runId)!==(next.cameraRunId||next.runId))return camera;
 if(![previous.width,previous.height,next.width,next.height,camera.x,camera.y,camera.z].every(Number.isFinite))return camera;
 return {...camera,x:camera.x+(next.width-previous.width)*camera.z/2,y:camera.y+(next.height-previous.height)*camera.z/2-(Number.isFinite(next.anchorY)&&Number.isFinite(previous.anchorY)?next.anchorY-previous.anchorY:0)*camera.z};
}
// Follow moves only enough to keep an actual active stage in the useful area.
// It does not change zoom, select a node or create execution state.
export function workflowFollowCamera(position,scene,viewport,camera){
 const z=camera.z,W=viewport.width,H=viewport.height;
 const x=W/2+camera.x+(position[0]-scene.width/2)*z,y=H/2+camera.y+(position[1]-scene.height/2)*z;
 const l=Math.min(W/2,110*z+20),r=Math.max(W/2,W-110*z-20),t=Math.min(H/2,64+34*z),b=Math.max(H/2,H-64-135*z);
 return {...camera,x:camera.x+(x<l?l-x:x>r?r-x:0),y:camera.y+(y<t?t-y:y>b?b-y:0)};
}
// A genuine plan/run transition must not strand every current card outside the
// viewport after a rewind adds historical rows. Never fit or target history.
export function workflowTransitionCamera(previous,next,view,viewport,camera,selectedId=null){
 if(!previous||!next||previous.sessionId!==next.sessionId||previous.runId===next.runId)return camera;
 const active=(view.work||[]).filter(g=>!g.readOnlyHistory&&!g.continuedHistory&&!g.branchCandidate&&Array.isArray(view.positions?.[g.id]));
 if(!active.length||![viewport.width,viewport.height,view.width,view.height,camera.x,camera.y,camera.z].every(Number.isFinite))return camera;
 const visible=g=>{const p=view.positions[g.id],x=viewport.width/2+camera.x+(p[0]-view.width/2)*camera.z,y=viewport.height/2+camera.y+(p[1]-view.height/2)*camera.z;return x-110*camera.z>=8&&x+110*camera.z<=viewport.width-8&&y-34*camera.z>=64&&y+135*camera.z<=viewport.height-48;};
 if(active.some(visible))return camera;
 const target=active.find(g=>g.id===selectedId)||active[0];
 return workflowFollowCamera(view.positions[target.id],view,viewport,camera);
}
// Only a fresh event for this session and run may suggest a camera target.
// Selecting a journal remains entirely separate from following live work.
export function workflowEventTarget(s,view,event){
 if(!event||event.sessionId&&event.sessionId!==s.id)return null;
 if(event.type?.startsWith('runtime.')){
  const operation=event.operationId||event.lineage?.attemptId;
  if(!['runtime.starting','runtime.progress','runtime.qa_started'].includes(event.type)||operation!==s.runtimeRecord?.operationId)return null;
  const stage=view.work.find(g=>g.observedStage&&g.runtimeStage&&g.operationId===operation&&g.status==='working'&&(event.phase&&g.startPhase===event.phase||g.startPhase===event.type));if(stage)return stage;
  return view.work.find(g=>g.runtime&&g.status==='working'&&g.runtimeRecord.binding?.sessionId===s.id&&g.runtimeRecord.operationId===operation)||null;
 }
 if(event.runId!==s.liveRun?.runId||s.liveRun?.status!=='running')return null;
 if(event.type==='work.step.started')return view.work.find(g=>g.dynamicWork&&g.runId===event.runId&&g.workStepId===event.workStepId)||null;
 if(event.type==='task.started')return view.work.find(g=>g.status==='working'&&g.taskIds.includes(event.runId+':'+event.taskId))||null;
 if(event.type==='work.progress')return view.work.find(g=>g.observedStage&&g.status==='working'&&g.runId===event.runId&&g.startPhase===event.phase)||null;
 if(event.type==='tool.started'&&event.agentId===event.runId+':project-author')return view.work.find(g=>g.projectGeneration&&g.status==='working'&&g.tasks.some(t=>t.runId===event.runId))||null;
 if(event.type==='project_recovery.created')return view.work.find(g=>g.projectRepair&&g.status==='working'&&g.tasks.some(t=>t.runId===event.runId))||null;
 return null;
}
// Explicit fit is an overview; the initial view uses a readable scale above.
export function workflowFitZoom({width,height,viewportWidth,viewportHeight,windowWidth,indexOpen=true}){
 const w=Number.isFinite(width)&&width>0?width:1,h=Number.isFinite(height)&&height>0?height:1;
 // Fit must contain even a long retained history; manual zoom's readability floor is not a Fit limit.
 return Math.min(1.15,Math.max(1,viewportWidth-48)/w,Math.max(1,viewportHeight-125)/h);
}
export function fitOnSessionChange(tab,s){return tab==='architecture'||tab==='workflow'&&!!s?.workflow?.tasks?.length;}
// Long edges follow empty channels between cards; endpoints remain the real DAG.
export function workflowEdgePath(a,b){
 const dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy)||1;
 const ux=dx/distance,uy=dy/distance,start=[a[0]+ux*34,a[1]+uy*34],end=[b[0]-ux*34,b[1]-uy*34];
 const reach=Math.max(48,Math.min(180,Math.abs(dx)*.42)),sign=dx>=0?1:-1;
 // A shallow arch keeps long same-level links off intermediate node centers.
 const arch=Math.abs(dy)<1&&Math.abs(dx)>280?-72:0;
 return `M${start[0]} ${start[1]} C${start[0]+sign*reach} ${start[1]+dy*.12+arch},${end[0]-sign*reach} ${end[1]-dy*.12+arch},${end[0]} ${end[1]}`;
}
/** Display grouping only. Authoritative tasks, dependencies, events and agents remain intact. */
const runOf=t=>t?.runId||(/^run_[^:]+/.exec(t?.id||'')||[])[0];
const done=new Set(['completed','done','succeeded','verified']);
/** Prefer model-authored labels. A bounded saved-goal excerpt is not an AI summary. */
export function goalLabel(s,runId=null,rawGoal=''){
 const owned=x=>x&&(!x.sessionId||x.sessionId===s.id),p=owned(s.pendingPlan)?s.pendingPlan:null,history=(s.goalHistory||[]).find(h=>h.runId===runId&&owned(h));
 const current=p&&(!runId||runId===p.runId||!history&&rawGoal===p.goal);
 const candidate=current?p:history;
 const title=typeof candidate?.goalTitle==='string'&&candidate.goalTitle.trim().length<=80?candidate.goalTitle.trim():'';
 const summary=typeof candidate?.goalSummary==='string'&&candidate.goalSummary.trim().length<=240?candidate.goalSummary.trim():'';
 const saved=typeof candidate?.goal==='string'?candidate.goal:(!runId||rawGoal===s.goal)&&!s.pendingPlan&&s.structureProvenance&&typeof s.goal==='string'?s.goal:'';
 const compact=saved.replace(/\s+/g,' ').trim(),points=Array.from(compact),excerpt=points.length>64?points.slice(0,61).join('').replace(/\s+\S*$/,'').trimEnd()+'…':compact;
 return title||summary||excerpt||(rawGoal||p?.goal||s.goal?'Goal awaiting summary':'');
}
export function runCompletionMeaning(s,runId){const event=(s.events||[]).findLast(e=>(e.runId===runId||e.id?.startsWith(runId+':'))&&e.type==='run.completed');return event?.meaning||event?.summary||'';}
/** A dependency queue is not an error. This changes display state, never task admission. */
export function taskDisplayStatus(s,task,runStatus=null,seen=new Set()){
 if(task?.status==='retained'&&task.retainedEvidence)return 'retained';
 const runId=runOf(task),status=runStatus||(s.liveRun&&s.liveRun.runId===runId?s.liveRun.status:s.runs?.find(r=>r.id===runId)?.status);
 if(status==='cancelled'&&task?.status==='failed'&&['run_cancelled','provider_timeout_or_cancelled'].includes((s.events||[]).findLast(e=>e.taskId===task.id&&e.type==='task.failed')?.code))return 'cancelled';
 if(status==='cancelled'&&['working','running','ready','blocked'].includes(task?.status))return 'cancelled';
 if(status==='failed'&&['working','running'].includes(task?.status))return 'failed';
 if(status==='interrupted'&&['working','running','ready','blocked'].includes(task?.status))return 'interrupted';
 if(task?.status!=='blocked')return task?.status||'unknown';
 if(status==='cancelled')return 'cancelled';
 if(status==='failed'||seen.has(task.id)||!task.deps?.length)return 'blocked';
 const next=new Set(seen).add(task.id),tasks=s.workflow?.tasks||[],deps=task.deps.map(id=>tasks.find(t=>t.id===id)),unmet=deps.filter(t=>!t||!done.has(t.status));
 if(!unmet.length||unmet.some(t=>!t||['failed','cancelled','blocked'].includes(taskDisplayStatus(s,t,status,next))))return 'blocked';
 return 'waiting';
}
// A linked restore creates a new plan ID but does not rewrite the immutable
// source snapshot or its runtime provenance. Only server-reconciled source
// aliases may bridge that selected plan to the original source plan.
function runtimeLineageMatches(event,bundle,selectedPlanId,operationId){
 const l=event?.lineage;
 return sourceMatchesPlan(bundle,selectedPlanId)&&l?.goalRevision===bundle.planRunId&&l.architectureRevision===bundle.planRunId&&l.planRevision===bundle.planRevision&&l.nodeId==='runtime'&&l.attemptId===operationId;
}
// Runtime evidence is a separate operation, never an authoring task completion.
export function runtimeProjection(s,sourceRunIds,expectedBundle=null,online=true,expectedPlanId=null){
 const r=s.runtimeRecord,b=r?.binding;
 if(!r||!/^[-A-Za-z0-9_]{8,100}$/.test(r.operationId||'')||b?.sessionId!==s.id||!/^run_[A-Za-z0-9-]+$/.test(b.runId||'')||!/^[a-f0-9]{64}$/.test(b.revision||'')||!sourceRunIds.includes(b.runId))return null;
 if(expectedBundle&&(b.runId!==expectedBundle.runId||b.revision!==expectedBundle.revision))return null;
 const events=(Array.isArray(r.events)?r.events:[]).filter(e=>e&&(!e.operationId||e.operationId===r.operationId)&&/^runtime\.(starting|progress|qa_started|qa_check|qa_completed|ready|failed|stopped|stop_failed)$/.test(e.type||''));
 const matches=e=>runtimeLineageMatches(e,expectedBundle,expectedPlanId,r.operationId);
 const lineageConfirmed=!expectedBundle||events.some(matches)&&events.every(e=>!e.lineage||matches(e));
 const displayStatus=!lineageConfirmed||!online&&r.status==='ready'?'unconfirmed':r.status;
 const status=displayStatus==='starting'?'working':displayStatus==='ready'&&r.buildPassed===true&&events.some(e=>e.type==='runtime.ready')&&Date.parse(r.expiresAt)>Date.now()?'ready':['failed','stop_failed'].includes(displayStatus)?'failed':displayStatus==='stopped'?'stopped':'interrupted';
 return {id:'runtime:'+r.operationId,key:'runtime:'+r.operationId,runId:b.runId,title:'Build & preview',runtime:true,runtimeRecord:{...r,status:displayStatus,events},taskIds:[],tasks:[],deps:[],artifactCount:0,status};
}
// A runtime is evidence for the goal only when its saved source AND recorded
// architecture/plan lineage match the inspected goal. A ready flag alone is
// insufficient, especially after restore or a late result from an older run.
export function goalRuntimeMeaning(s,runId,bundle,runtime,currentSource){
 if(!bundle||!runtime||!sourceMatchesPlan(bundle,runId))return null;
 const r=runtime.runtimeRecord,b=r.binding;
 if(b?.sessionId!==s.id||b.runId!==bundle.runId||b.revision!==bundle.revision)return null;
 const matches=e=>runtimeLineageMatches(e,bundle,runId,r.operationId);
 if(!r.events.some(matches)||r.events.some(e=>e.lineage&&!matches(e)))return 'Source saved · preview lineage unconfirmed';
 const sourceState=sourceStateFor(bundle,currentSource);
 if(sourceState==='different')return 'Source saved · current source differs';
 if(sourceState!=='current')return 'Source saved · current source unconfirmed';
 if(r.status==='starting')return r.events.some(e=>['runtime.starting','runtime.progress'].includes(e.type)&&matches(e))?'Building reviewed source':'Preview status unconfirmed';
 if(r.status==='stopping'||r.status==='stop_failed')return 'Preview stop unconfirmed';
 if(['failed','unavailable','review_failed'].includes(r.status))return r.events.some(e=>e.type==='runtime.failed'&&matches(e))?'Preview failed':'Preview status unconfirmed';
 const ready=r.buildPassed===true&&r.events.some(e=>e.type==='runtime.ready'&&matches(e));
 const qa=!ready?'build unverified':r.functionalTests==='http_passed'&&r.qaReport?.status==='passed'?'API checks passed · UI unverified':r.functionalTests==='http_failed'&&r.qaReport?.status==='failed'?'API checks failed':'tests unverified';
 if(r.status==='ready'&&ready&&Date.parse(r.expiresAt)>Date.now())return (s.pendingPlan?.runId!==runId||s.pendingPlan?.stale?'Earlier preview live · ':'Preview live · ')+qa;
 if(r.status==='stopped')return ready?'Preview stopped · '+qa:'Preview stopped · build unverified';
 if(r.status==='expired'||r.status==='ready'&&ready&&Date.parse(r.expiresAt)<=Date.now())return 'Preview expired · '+qa;
 return 'Preview status unconfirmed';
}
function projectionSourceTasks(s){
 const tasks=s.workflow?.tasks||[],eligible=new Set();
 for(const e of s.events||[]){if(e.type!=='project.generating'||e.sessionId!==s.id||e.strategy!=='static-react-packages-v1'||e.scope!=='static_frontend_only'||e.goalCompletion!=='not_established'||!/^[a-f0-9]{64}$/.test(e.planRevision||''))continue;
  const start=(s.events||[]).find(x=>x.type==='run.started'&&x.runId===e.runId&&x.sessionId===s.id);
  try{const admission=safePackageAdmission(start).strategyAdmission,workers=tasks.filter(t=>t.runId===e.runId&&t.id===e.runId+':'+t.backendTaskId);if(admission?.planRunId===e.planRunId&&workers.length===admission.packageCount)eligible.add(e.runId);}catch{}
 }
 return tasks.map(t=>!t.projectDraft&&eligible.has(t.runId)&&t.id===t.runId+':'+t.backendTaskId?{...t,projectDraft:true}:t);
}
export function workflowPresentation(s,requestedRun=null,{currentSource,online=true,includeHistory=false,includeContinuation=true}={}){
 const tasks=projectionSourceTasks(s),runIds=[...new Set([...(s.runs||[]).map(r=>r.id),...tasks.map(runOf).filter(Boolean)])];
 // Imported WorkGraphs deliberately have fresh task IDs and no execution binding.
 // Historical run records must not hide that inert local blueprint.
 const hasLocalBlueprint=tasks.some(t=>!runOf(t));
 // Planning a replacement does not erase the accepted blueprint while waiting.
 // An empty interim world would shrink under a new run ID, then incorrectly
 // add growth compensation when that run finally supplies its tasks.
 let runId=runIds.includes(requestedRun)?requestedRun:((s.liveRun?.conversation||s.liveRun?.interactionMode==='plan'&&s.pendingPlan?.runId&&s.pendingPlan.runId!==s.liveRun.runId)?s.pendingPlan?.runId:s.liveRun?.runId)||(hasLocalBlueprint?'local':runIds.at(-1))||'local';
 // Source generation is shown alongside its recorded plan, without relying
 // on a removed history selector. A newer/restored current plan takes priority;
 // only exact source aliases below may supply its execution evidence.
 const currentPlan=runIds.includes(s.pendingPlan?.runId)?s.pendingPlan.runId:null;
 const liveGeneration=(s.events||[]).findLast(e=>e.type==='project.generating'&&e.runId===s.liveRun?.runId&&(!e.sessionId||e.sessionId===s.id)&&runIds.includes(e.planRunId));
 if(!requestedRun&&liveGeneration)runId=currentPlan||liveGeneration.planRunId;
 const activeStart=(s.events||[]).find(e=>e.type==='run.started'&&e.runId===s.liveRun?.runId&&e.sessionId===s.id),approvedCameraPlan=activeStart?.lineage?.goalRevision;
 if(!requestedRun&&s.liveRun?.interactionMode==='agent'&&approvedCameraPlan===s.pendingPlan?.runId&&runIds.includes(approvedCameraPlan)&&!tasks.some(t=>runOf(t)===runId&&!t.id.endsWith(':goal')))runId=approvedCameraPlan;
 // A completed source-generation run links to its recorded approved plan. Keep active runs and explicit historical selections in view.
 if(!requestedRun&&s.liveRun?.status!=='running'){const bundle=(s.projectBundles||[]).findLast(b=>(b.runId===runId||b.runId===s.liveRun?.runId)&&runIds.includes(b.planRunId)&&/^[a-f0-9]{64}$/.test(b.revision||''));if(bundle)runId=currentPlan||bundle.planRunId;}
 const chosen=s.runs?.find(r=>r.id===runId);if(chosen?.recovery||chosen?.continuation||chosen?.projectRecovery)runId=(chosen.recovery||chosen.continuation||chosen.projectRecovery).originalRunId;
 const linked=(s.runs||[]).filter(r=>(r.recovery||r.continuation||r.projectRecovery)?.originalRunId===runId),linkedIds=new Set(linked.map(r=>r.id));
 const candidates=(s.projectBundles||[]).filter(b=>runIds.includes(b.runId)&&/^[a-f0-9]{64}$/.test(b.revision||''));
 const sourceBundle=candidates.findLast(b=>b.planRunId===runId)||candidates.findLast(b=>sourceMatchesPlan(b,runId));
 // A recorded strategy and plan binding decide which actual worker events can be shown.
 const sourcePlan=sourceBundle?.planRunId||runId;
 const generation=(s.events||[]).findLast(e=>e.type==='project.generating'&&e.planRunId===sourcePlan&&runIds.includes(e.runId)&&!s.runs?.find(r=>r.id===e.runId)?.projectRecovery);
 const sourceRunIds=[...new Set([sourceBundle?.runId,generation?.runId].filter(Boolean))];
 let scoped=tasks.filter(t=>runId==='local'?!runOf(t):runOf(t)===runId||linkedIds.has(runOf(t)));
 const schemaPublished=sourceBundle?.planRunId===runId&&projectBundleSchemaValidated(s,sourceBundle);
 if(['staged-artifacts-v1','static-react-packages-v1'].includes(generation?.strategy)||schemaPublished&&generation?.runId===sourceBundle.runId){
  const planned=scoped.filter(t=>t.runId===runId&&!t.id.endsWith(':goal')),drafts=tasks.filter(t=>t.runId===generation.runId&&t.projectDraft);
  const byId=new Map(drafts.map(t=>[t.backendTaskId,t]));
  const compatible=planned.length>0&&planned.length===drafts.length&&planned.every(p=>{const d=byId.get(p.backendTaskId||p.workItemId);return d&&(d.title||d.text)===(p.title||p.text)&&d.instructions===p.instructions&&(d.phaseId||null)===(p.phaseId||null)&&(d.phaseTitle||null)===(p.phaseTitle||null)&&JSON.stringify((d.deps||[]).map(id=>id.slice(generation.runId.length+1)))===JSON.stringify((p.deps||[]).map(id=>id.slice(runId.length+1)));});
  if(compatible)scoped=scoped.map(t=>t.runId===runId&&!t.id.endsWith(':goal')?byId.get(t.backendTaskId||t.workItemId):t);
  if(generation.runId!==runId)scoped.push(...tasks.filter(t=>t.runId===generation.runId&&t.proposedExpansion?.planRunId===runId&&t.proposedExpansion?.planRevision===generation.planRevision));
 }
 const root=scoped.find(t=>t.id.endsWith(':goal')),internal=scoped.filter(t=>t!==root&&!t.id.endsWith(':goal'));
 const projectEvent=(s.events||[]).findLast(e=>e.runId===runId&&e.type==='project.generating'),projectGeneration=!!projectEvent&&!s.runs?.find(r=>r.id===runId)?.projectRecovery;
 const generationNode=sourceRunId=>{
  const start=(s.events||[]).findLast(e=>e.runId===sourceRunId&&e.type==='project.generating'),staged=['staged-artifacts-v1','static-react-packages-v1'].includes(start?.strategy),sourceStatus=s.liveRun?.runId===sourceRunId?s.liveRun.status:s.runs?.find(r=>r.id===sourceRunId)?.status;
  const saved=(s.projectBundles||[]).some(b=>b.runId===sourceRunId&&/^[a-f0-9]{64}$/.test(b.revision||''))||(s.events||[]).some(e=>e.runId===sourceRunId&&e.type==='project.generated');
  const authorStarted=(s.events||[]).some(e=>e.runId===sourceRunId&&e.type==='tool.started'&&e.agentId===sourceRunId+':project-author'&&e.name==='model.chat.completions');
  const draftTasks=internal.filter(t=>t.runId===sourceRunId&&t.projectDraft),depended=new Set(draftTasks.flatMap(t=>t.deps||[])),deps=staged?draftTasks.filter(t=>!depended.has(t.id)).map(t=>t.id):[];
  const status=saved?'source_saved':sourceStatus==='running'?(staged&&!authorStarted?'waiting':'working'):sourceStatus==='failed'&&staged&&!authorStarted?'blocked':sourceStatus||'unknown';
  return {id:sourceRunId+':project-generation',runId:sourceRunId,workItemId:'project-generation',workTitle:start?.strategy==='static-react-packages-v1'?'Save compiled source':'Assemble project source',projectGeneration:true,status,deps};
 };
 if(projectGeneration&&projectEvent?.strategy!=='trusted-declarative-crud-v1')internal.push(generationNode(runId));
 for(const sourceRunId of sourceRunIds)if(sourceRunId!==runId&&!(s.events||[]).some(e=>e.type==='project.generating'&&e.runId===sourceRunId&&e.strategy==='trusted-declarative-crud-v1'))internal.push(generationNode(sourceRunId));
 const record=s.runs?.find(r=>r.id===runId),active=s.liveRun?.runId===runId?s.liveRun:null;
 const rawGoal=root?.text||active?.goal||s.goal||'',goal=goalLabel(s,runId,rawGoal)||'Requested goal',historical=!active&&!!(s.continuationOf||s.structureProvenance);
 const meaning=runCompletionMeaning(s,runId),planOnly=!!active?.planOnly||['plan_ready_for_approval','plan_needs_clarification','plan_needs_design'].includes(meaning),answerOnly=meaning==='read_only_answer';
 const runStatus=historical?'historical':planOnly?'planned':active?.status||record?.status||root?.status||'unknown';
 const recovered=!!(active?.recovered||record?.historical&&record?.serverObserved),serverActive=!!(active?.serverObserved?active.active:record?.serverObserved&&record.active);
 // Stable display identity follows the recorded approved plan while the active view
 // moves from its generation attempt back to that plan at completion.
 const groupingPlanId=['staged-artifacts-v1','static-react-packages-v1'].includes(projectEvent?.strategy)&&runIds.includes(projectEvent.planRunId)?projectEvent.planRunId:runId;
 const groupingRunId=draftRefinementAncestors(s,groupingPlanId).at(-1)||groupingPlanId;
 const groups=new Map();
 for(const t of internal){const key=t.projectGeneration?t.runId+':project-generation':t.projectRecovery?t.runId+':project-repair':t.continuation?t.runId+':'+t.workItemId:t.recovery?t.runId+':repair':t.workItemId||t.id;if(!groups.has(key))groups.set(key,{id:(t.projectGeneration?t.runId:groupingRunId)+':work:'+key,key,runId,title:t.projectGeneration||t.projectRecovery||t.recovery||t.continuation?t.workTitle:t.workTitle||t.title||t.text||goal,taskIds:[],tasks:[],deps:[]});const group=groups.get(key);group.taskIds.push(t.id);group.tasks.push(t);}
 // The goal alone is not an executable work item. Until a plan event arrives,
 // show only the goal instead of inventing a placeholder stage.
 const work=[...groups.values()],owner=new Map(work.flatMap(g=>g.taskIds.map(id=>[id,g.id])));
 for(const g of work){
  const phases=g.tasks.map(t=>[t.phaseId,t.phaseTitle]).filter(([id,title])=>id&&title);if(phases.length&&phases.every(([id,title])=>id===phases[0][0]&&title===phases[0][1]))[g.phaseId,g.phaseTitle]=phases[0];
  g.deps=[...new Set(g.tasks.flatMap(t=>(t.deps||[]).map(d=>owner.get(d)).filter(id=>id&&id!==g.id)))];
  g.projectGeneration=g.tasks.some(t=>t.projectGeneration);
  g.projectDraft=g.tasks.some(t=>t.projectDraft);
  g.proposedExpansion=g.tasks.find(t=>t.proposedExpansion)?.proposedExpansion||null;
  const statuses=g.tasks.map(t=>projectGeneration&&!['staged-artifacts-v1','static-react-packages-v1'].includes(projectEvent?.strategy)&&t.runId===runId&&!t.projectGeneration&&!(s.events||[]).some(e=>e.taskId===t.id&&['task.started','task.completed','task.failed'].includes(e.type))?'planned':taskDisplayStatus(s,t,t.projectRecovery||t.recovery||t.continuation||t.runId!==runId?null:active?.status||record?.status));
  if(g.tasks.some(t=>t.recovery)){const original=g.tasks[0].recovery;const parent=owner.get(original.originalRunId+':'+original.originalTaskId);if(parent)g.deps=[parent];g.repair=true;}
  const readyEvidence=linked.filter(r=>r.recoveryCompleted).flatMap(r=>(s.events||[]).filter(e=>e.runId===r.id&&e.type==='recovery.completed').flatMap(e=>(e.dependentTaskIds||[]).map(id=>runId+':'+id)));g.continuationReady=!linked.some(r=>r.continuation)&&g.tasks.length>0&&g.tasks.every(t=>readyEvidence.includes(t.id)&&(t.deps||[]).every(id=>done.has(tasks.find(x=>x.id===id)?.status)||linked.some(r=>r.recoveryCompleted&&id===r.recovery.originalRunId+':'+r.recovery.originalTaskId)));
  if(g.tasks.some(t=>t.projectRecovery)){g.projectRepair=true;const original=g.tasks[0].projectRecovery;g.deps=work.filter(x=>x!==g&&x.tasks.some(t=>t.projectGeneration&&t.runId===original.originalRunId)).map(x=>x.id);}
  g.artifactCount=(s.artifacts||[]).filter(a=>g.taskIds.includes(a.taskId)).length;
  g.status=historical?'historical':statuses.length&&statuses.every(x=>x==='retained')?'retained':statuses.includes('proposed')?'proposed':statuses.includes('source_saved')?'source_saved':statuses.includes('failed')?'failed':statuses.includes('cancelled')?'cancelled':g.tasks.length&&statuses.every(x=>done.has(x))?'completed':statuses.includes('interrupted')?'interrupted':statuses.some(x=>['working','running'].includes(x))?'working':statuses.includes('blocked')?'blocked':!g.tasks.length?(['failed','cancelled','planned','completed','interrupted'].includes(runStatus)?runStatus:runStatus==='running'?'working':'unknown'):statuses.includes('ready')?'ready':statuses.includes('waiting')?'waiting':statuses.includes('planned')?'planned':'ready';
 }
 addAdaptiveWorkGroups(s,work);const runtimeBranchingGraph=applyRuntimeWorkflow(s,work);
 for(const g of work)if(g.continuationReady&&g.status==='blocked')g.status='ready_for_review';
 // Materialize a stage only after its actual persisted event arrives. These
 // are assembly operations, not new model-authored tasks or executed tests.
 for(const parent of work.filter(g=>g.projectGeneration)){
  const sourceRun=parent.tasks.find(t=>t.projectGeneration)?.runId;if(!sourceRun)continue;
  const startRun=(s.events||[]).find(e=>e.runId===sourceRun&&e.type==='project.generating'),events=(s.events||[]).filter(e=>e.runId===sourceRun&&(!e.sessionId||e.sessionId===s.id)&&!e.taskId&&e.type==='work.progress'&&Number.isInteger(e.sequence)&&e.id===sourceRun+':'+e.sequence&&(!e.lineage||e.lineage.nodeId==='project-generation'&&e.lineage.attemptId===sourceRun+':project-generation'&&(!startRun?.planRunId||e.lineage.goalRevision===startRun.planRunId)&&(!startRun?.planRevision||e.lineage.planRevision===startRun.planRevision))),sourceStatus=s.liveRun?.runId===sourceRun?s.liveRun.status:s.runs?.find(r=>r.id===sourceRun)?.status;
  let dependency=parent.id;
  for(const spec of [{key:'source-validation',title:'Check source format',start:'candidate_validation_started',end:'candidate_validation_passed'},{key:'source-save',title:'Save source snapshot',start:'snapshot_save_started',end:'snapshot_save_completed'}]){
   const start=events.find(e=>e.phase===spec.start);if(!start)continue;
   const finish=events.find(e=>e.phase===spec.end&&e.sequence>start.sequence);
   const status=finish?'completed':sourceStatus==='running'?'working':sourceStatus==='failed'?'failed':sourceStatus==='cancelled'?'cancelled':'interrupted';
   const stage={id:sourceRun+':stage:'+spec.key,key:spec.key,runId:sourceRun,title:spec.title,observedStage:true,startPhase:spec.start,events:[start,...(finish?[finish]:[])],taskIds:[],tasks:[],deps:[dependency],status,artifactCount:0};
   work.push(stage);dependency=stage.id;
  }
 }
 const runtime=runtimeProjection(s,[runId,...linkedIds,...sourceRunIds],sourceBundle,online,runId);if(runtime){
  const sourceParents=work.filter(g=>(g.projectGeneration||g.projectRepair)&&g.tasks.some(t=>t.runId===runtime.runId));runtime.deps=sourceParents.map(g=>work.findLast(x=>x.observedStage&&!x.runtimeStage&&x.runId===runtime.runId)?.id||g.id);work.push(runtime);
  if(runtime.runtimeRecord.status!=='unconfirmed'){
   const r=runtime.runtimeRecord,events=r.events||[];let dependency=runtime.id;
   for(const spec of [{key:'runtime-build',title:'Build reviewed source',start:'build_started',end:'build_passed'},{key:'runtime-qa',title:'Check local API',start:'runtime.qa_started',end:'runtime.qa_completed'}]){
    const is=(e,name)=>e.type===name||e.type==='runtime.progress'&&e.phase===name,start=events.find(e=>is(e,spec.start));if(!start)continue;
    const finish=events.find(e=>is(e,spec.end)&&e.sequence>start.sequence),result=finish&&(r.qaReport?.status||finish.report?.status),status=finish?(spec.key==='runtime-qa'?(result==='passed'?'completed':['failed','invalid'].includes(result)?'failed':'interrupted'):'completed'):r.status==='starting'?'working':['failed','stop_failed'].includes(r.status)?'failed':r.status==='stopped'?'cancelled':'interrupted';
    const scoped=events.filter(e=>e.sequence>=start.sequence&&(!finish||e.sequence<=finish.sequence)&&(spec.key==='runtime-qa'?['runtime.qa_started','runtime.qa_check','runtime.qa_completed'].includes(e.type):is(e,spec.start)||is(e,spec.end)));
    const stage={id:r.operationId+':stage:'+spec.key,key:spec.key,runId:runtime.runId,operationId:r.operationId,title:spec.title,observedStage:true,runtimeStage:true,startPhase:spec.start,events:scoped,taskIds:[],tasks:[],deps:[dependency],status,artifactCount:0};work.push(stage);dependency=stage.id;
   }
  }
 }
 const depth=new Map();function visit(g,seen=new Set()){if(depth.has(g.id))return depth.get(g.id);if(seen.has(g.id))return 0;const next=new Set(seen).add(g.id),n=g.deps.length?1+Math.max(...g.deps.map(id=>visit(work.find(x=>x.id===id),next))):0;depth.set(g.id,n);return n;}
 work.forEach(g=>visit(g));
 const hasArtifacts=(s.artifacts||[]).some(a=>a.runId===runId||scoped.some(t=>t.id===a.taskId));
 const approval=s.pendingPlan?.runId===runId&&s.pendingPlan.approved;
 const savedProject=(s.events||[]).findLast(e=>e.runId===runId&&e.type==='project.generated');
 const savedCount=Number.isSafeInteger(savedProject?.fileCount)&&savedProject.fileCount>0?savedProject.fileCount:null;
 const sourceSaved=!!savedProject&&runStatus==='completed';
 const linkedSourceSaved=!!sourceBundle&&sourceBundle.runId!==runId;
 const runtimeMeaning=goalRuntimeMeaning(s,runId,sourceBundle,runtime,currentSource);
 const activeWorkMeaning=activePlanWorkLabel(s,runId),stoppedRefinementMeaning=refinementStoppedLabel(s,runId);
 const stoppedSourceAttempt=!!generation&&generation.sessionId===s.id&&generation.planRunId===runId&&(s.events||[]).some(e=>e.sessionId===s.id&&e.runId===generation.runId&&e.type==='run.cancelled')&&!(s.events||[]).some(e=>e.sessionId===s.id&&e.runId===generation.runId&&['project.generated','run.completed'].includes(e.type));
 const planReviewLabel=planOnly?planReviewPendingLabel(s,runId):null;
 const target={id:runId+':target',runId,title:goal,status:activeWorkMeaning?'running':stoppedRefinementMeaning||stoppedSourceAttempt?'cancelled':sourceSaved?'source_saved':runStatus,meaning:activeWorkMeaning||stoppedRefinementMeaning||(stoppedSourceAttempt?'Source generation stopped · outcome unverified':null)||runtimeMeaning||(schemaPublished?'Schema source saved · runtime and goal unverified':sourceSaved?(savedCount?savedCount+' source files saved · unverified':'Project source saved · unverified'):linkedSourceSaved?'Source saved from this plan · execution unverified':linked.some(r=>r.projectRecoveryCompleted)?'Regenerated source saved · execution not run':linked.some(r=>r.continuationCompleted)?'Continued outputs saved · execution not run':linked.some(r=>r.continuation)?'Continuation recorded · see task status':linked.some(r=>r.recoveryCompleted)?'Repair saved · downstream not run':meaning==='plan_needs_design'?'Design needs refinement':runStatus==='planned'?(planReviewLabel||(approval?'Approved · not started':'Review before Run')):runStatus==='completed'?(answerOnly?'Answer recorded · no files changed':hasArtifacts?'Outputs saved · unverified':'Run ended · no saved files'):runStatus==='failed'?'Blocked by recorded failure':runStatus==='cancelled'?'Stopped':runStatus==='interrupted'?'Interrupted · not resumed':runStatus==='historical'?'Historical evidence':recovered&&serverActive?'Observed running · not resumed':'Requested outcome')};
 const {positions,width,height}=layoutWorkflow(work,target,depth);
 const edges=[...work.flatMap(g=>g.deps.map(from=>({from,to:g.id,...(g.runtimeRouteCandidate?{candidate:true,decision:true}:{})}))),...(!runtimeBranchingGraph||sourceSaved?work.filter(g=>!g.branchCandidate&&(!g.coarseMilestone||g.milestoneArrived)&&!work.some(x=>!x.branchCandidate&&x.deps.includes(g.id))).map(g=>({from:g.id,to:target.id,target:true})):[])];
 const cameraStart=(s.events||[]).find(e=>e.type==='run.started'&&e.runId===runId&&e.sessionId===s.id),cameraPlan=cameraStart?.lineage?.goalRevision;
 const cameraRunId=runIds.includes(cameraPlan)&&cameraPlan===s.pendingPlan?.runId?cameraPlan:runId;
 const result={runId,cameraRunId,runIds,linkedRunIds:[...linkedIds],sourceRunIds,root,work,target,positions,edges,width,height,historical,planOnly,answerOnly,planReviewLabel,designIncomplete:meaning==='plan_needs_design',recovered,serverActive};
 if(includeContinuation)withContinuedWorkflow(s,result,{currentSource,online});
 withBranchCandidates(s,result);
 withPackageChoiceBranches(s,result);
 if(includeHistory)withHistoricalWorkflow(s,result,{currentSource,online});
 // Advance only recorded completed work within its existing dependency column.
 // Proposal/history/status-only snapshots never acquire this success cue.
 for(const g of result.work){if(g.branchCandidate||g.readOnlyHistory||g.status!=='completed'||!g.tasks?.length)continue;
  const confirmed=g.tasks.every(t=>(s.events||[]).some(e=>e.type==='task.completed'&&e.taskId===t.id&&e.runId===t.runId&&(!e.sessionId||e.sessionId===s.id)));
  if(confirmed){result.positions[g.id][0]+=40;g.completionAdvance=40;}
 }
 // One outcome endpoint remains beyond every visible comparison lane. This is
 // geometry only: proposals do not become dependencies or completion evidence.
 const goalX=Math.max(130,...result.work.map(g=>result.positions[g.id][0]+230));
 result.positions[result.target.id][0]=goalX;result.width=Math.max(result.width,goalX+130);
 return result;
}
export function workEvents(s,view,group=null){
 if(group?.branchCandidate)return [];
 if(group?.runtime)return group.runtimeRecord.events;
 if(group?.observedStage)return group.events||[];
 const ids=new Set(group?.taskIds||view.work.flatMap(g=>g.taskIds));
 return (s.events||[]).filter(e=>!e.sessionId||e.sessionId===s.id).filter(e=>e.runId===view.runId||view.linkedRunIds?.includes(e.runId)||view.sourceRunIds?.includes(e.runId)||e.id?.startsWith(view.runId+':')).filter(e=>!group||(group.projectRepair||group.projectGeneration)&&group.tasks.some(t=>t.runId===e.runId)||!!e.taskId&&ids.has(e.taskId));
}
// Prior attempts are shown only when both the exact plan digest and the task
// definition match. A new goal/design/source baseline must not borrow a log.
export function priorWorkAttempts(s,group){
 const current=group?.tasks?.find(t=>t.projectDraft&&t.backendTaskId);if(!current)return [];
 const events=s.events||[],start=events.find(e=>e.runId===current.runId&&e.type==='project.generating'&&['staged-artifacts-v1','static-react-packages-v1'].includes(e.strategy));
 if(!start||!/^[a-f0-9]{64}$/.test(start.planRevision||''))return [];
 const same=(a,b)=>a.backendTaskId===b.backendTaskId&&(a.title||a.text)===(b.title||b.text)&&a.instructions===b.instructions&&(a.phaseId||null)===(b.phaseId||null)&&(a.phaseTitle||null)===(b.phaseTitle||null)&&JSON.stringify((a.deps||[]).map(d=>d.slice(a.runId.length+1)))===JSON.stringify((b.deps||[]).map(d=>d.slice(b.runId.length+1)));
 return events.filter(e=>e.type==='project.generating'&&['staged-artifacts-v1','static-react-packages-v1'].includes(e.strategy)&&e.runId!==current.runId&&e.planRunId===start.planRunId&&e.planRevision===start.planRevision).flatMap(e=>{
  const task=(s.workflow?.tasks||[]).find(t=>t.runId===e.runId&&t.projectDraft&&same(t,current));if(!task)return [];
  return [{runId:e.runId,task,events:events.filter(x=>x.runId===e.runId&&x.taskId===task.id)}];
 });
}
// Earlier plan work is evidence only. Matching labels and dependencies do not
// establish that a draft is valid for a changed goal or architecture.
export function priorPlanWork(s,group){
 const tasks=s.workflow?.tasks||[],events=(s.events||[]).filter(e=>!e.sessionId||e.sessionId===s.id),planId=group?.runId;
 if(!planId||group?.runtime||group?.tasks?.length!==1)return [];
 const key=group.tasks[0]?.backendTaskId||group.tasks[0]?.workItemId;
 let current=tasks.find(t=>t.runId===planId&&t.backendTaskId===key&&!t.projectDraft);
 if(!current||!key)return [];
 const same=(a,b)=>a.backendTaskId===b.backendTaskId&&(a.title||a.text)===(b.title||b.text)&&a.instructions===b.instructions&&(a.phaseId||null)===(b.phaseId||null)&&(a.phaseTitle||null)===(b.phaseTitle||null)&&JSON.stringify((a.deps||[]).map(d=>d.slice(a.runId.length+1)))===JSON.stringify((b.deps||[]).map(d=>d.slice(b.runId.length+1)));
 const history=s.planHistory||[],seen=new Set([planId]),results=[];let id=planId;
 for(let depth=0;depth<20;depth++){
  const record=id===s.pendingPlan?.runId?s.pendingPlan:history.find(p=>p.runId===id),parent=record?.revisionOf?.basePlanRunId;
  if(!parent||seen.has(parent))break;seen.add(parent);
  const previous=tasks.find(t=>t.runId===parent&&t.backendTaskId===key&&!t.projectDraft);
  if(!previous||!same(current,previous))break;
  for(const start of events.filter(e=>e.type==='project.generating'&&e.planRunId===parent&&['staged-artifacts-v1','static-react-packages-v1'].includes(e.strategy)&&/^[a-f0-9]{64}$/.test(e.planRevision||''))){
   const draft=tasks.find(t=>t.runId===start.runId&&t.projectDraft&&same(t,previous));
   const recorded=draft&&events.filter(e=>e.runId===start.runId&&e.taskId===draft.id);
   if(recorded?.length)results.push({planRunId:parent,runId:start.runId,task:draft,events:recorded});
  }
  current=previous;id=parent;
 }
 return results.slice(-10);
}

// Only explicitly recorded same-draft links fold visually. The source history is untouched.
export function draftRefinementAncestors(s,runId){
 const records=new Map((s.planHistory||[]).map(p=>[p.runId,p]));if(s.pendingPlan?.runId)records.set(s.pendingPlan.runId,s.pendingPlan);
 for(const e of s.events||[])if(e.type==='plan.created'&&(!e.sessionId||e.sessionId===s.id)&&!records.has(e.runId))records.set(e.runId,e);
 const ancestors=[],seen=new Set([runId]);let current=records.get(runId);
 while(current?.draftRefinement&&!current.restoreOf&&!current.branchOf){const link=current.draftRefinement,parent=records.get(link.basePlanRunId);if(!parent||seen.has(parent.runId)||!link.proposalRunId||current.revisionOf?.basePlanRunId!==link.basePlanRunId||current.revisionOf?.proposalRunId!==link.proposalRunId)break;ancestors.push(parent.runId);seen.add(parent.runId);current=parent;}
 return ancestors;
}
// Clarification replaces a draft visually, not the identity or execution of its tasks.
export function visualDraftAncestors(s,runId){
 const records=new Map();
 for(const p of s.planHistory||[])if(!p.sessionId||p.sessionId===s.id)records.set(p.runId,p);
 if(s.pendingPlan?.runId&&(!s.pendingPlan.sessionId||s.pendingPlan.sessionId===s.id))records.set(s.pendingPlan.runId,s.pendingPlan);
 const events=(s.events||[]).filter(e=>e.sessionId===s.id);
 for(const e of events)if(e.type==='plan.created'&&!records.has(e.runId))records.set(e.runId,e);
 const completed=id=>events.some(e=>e.runId===id&&e.type==='run.completed')&&!events.some(e=>e.runId===id&&['run.failed','run.cancelled'].includes(e.type))&&!(s.runs||[]).some(r=>r.id===id&&r.status!=='completed');
 const ancestors=[],seen=new Set([runId]);let current=records.get(runId);
 while(current&&!current.restoreOf&&!current.branchOf){
  let parent;const d=current.draftRefinement;
  if(d&&d.proposalRunId&&current.revisionOf?.basePlanRunId===d.basePlanRunId&&current.revisionOf?.proposalRunId===d.proposalRunId)parent=records.get(d.basePlanRunId);
  else if(!d&&!current.revisionOf){
   const h=current.clarificationHistory?.at(-1),p=h&&records.get(h.basePlanRunId);
   if(p&&completed(current.runId)&&completed(p.runId)&&Array.isArray(p.clarificationQuestions)&&p.clarificationQuestions.length>0&&JSON.stringify(h.questions)===JSON.stringify(p.clarificationQuestions)&&typeof h.answer==='string'&&h.answer.trim()&&h.answer.length<=3000&&(h.sourceRevision||null)===(p.sourceRevision||null)&&current.originalGoalRunId===(p.originalGoalRunId||p.runId)&&typeof current.originalGoal==='string'&&current.originalGoal===(p.originalGoal||p.goal)&&current.goal===p.goal)parent=p;
  }
  if(!parent)break;if(seen.has(parent.runId))return [];
  ancestors.push(parent.runId);seen.add(parent.runId);current=parent;
 }
 return ancestors;
}
// The UI journal deliberately omits raw plan payloads. Join its session-bound
// plan events to the retained plan/design/task projections instead of assuming
// s.events contains server events verbatim.
export function savedPlanVersions(s){
 const events=(s.events||[]).filter(e=>!e.sessionId||e.sessionId===s.id),known=new Set([s.pendingPlan?.runId,...(s.planHistory||[]).map(p=>p.runId),...(s.designVersions||[]).map(v=>v.id)]);
 return events.filter(e=>e.type==='plan.created'&&e.interactionMode!=='agent'&&(e.interactionMode==='plan'||known.has(e.runId)||events.some(x=>x.runId===e.runId&&x.type==='run.completed'&&['plan_ready_for_approval','plan_needs_clarification','plan_needs_design'].includes(x.meaning)))).map(e=>{
  const plan=s.pendingPlan?.runId===e.runId?s.pendingPlan:(s.planHistory||[]).find(p=>p.runId===e.runId),graph=(s.designVersions||[]).find(v=>v.id===e.runId)?.graph||e.architecture||plan?.architecture;
  const tasks=Array.isArray(e.tasks)?e.tasks:(s.workflow?.tasks||[]).filter(t=>t.runId===e.runId&&!t.id.endsWith(':goal')&&!t.projectDraft).map(t=>({id:t.backendTaskId||t.workItemId||t.id.slice(e.runId.length+1),title:t.title||t.text,instruction:t.instructions||'',dependencies:(t.deps||[]).map(d=>d.startsWith(e.runId+':')?d.slice(e.runId.length+1):d),role:t.role||'implementation',outputKind:t.outputKind||'artifact'}));
  return {...e,...Object.fromEntries(['agentIteration','draftRefinement','revisionOf','restoreOf','branchOf'].filter(k=>plan?.[k]).map(k=>[k,plan[k]])),goal:e.goal||plan?.goal||(s.workflow?.tasks||[]).find(t=>t.runId===e.runId&&t.id.endsWith(':goal'))?.text||'',tasks,architecture:graph?{kind:graph.kind,nodes:graph.nodes,edges:graph.edges,groups:graph.groups||[]}:null};
 });
}
// Audit versions are not parallel live blueprints. Gray comparisons need an
// explicit inspection or recorded restore/branch; draft authoring is not execution.
export function historicalCanvasPlanIds(s,currentId){
 const plans=savedPlanVersions(s),records=new Map(plans.map(p=>[p.runId,p])),all=new Set(records.keys());
 if(!records.has(currentId))return new Set();
 if(s.selectedDesignVersionId===currentId&&s.pendingPlan?.runId&&currentId!==s.pendingPlan.runId)return all;
 const seen=new Set();let cursor=records.get(currentId);
 while(cursor&&!seen.has(cursor.runId)){
  seen.add(cursor.runId);
  const source=cursor.restoreOf?.sourcePlanRunId,previous=cursor.restoreOf?.previousPlanRunId;
  if(records.has(source)&&records.has(previous)){
   const start=plans.findIndex(p=>p.runId===source),end=plans.findIndex(p=>p.runId===previous);
   // Only the recorded displaced suffix belongs to this rewind. Later normal
   // refinements and the retained prefix are audit history, not abandoned work.
   return new Set(end>start?plans.slice(start+1,end+1).map(p=>p.runId):[]);
  }
  const base=cursor.branchOf?.basePlanRunId||cursor.branchOf?.sourcePlanRunId;
  if(records.has(base))return new Set([base]);
  cursor=records.get(cursor.revisionOf?.basePlanRunId||cursor.draftRefinement?.basePlanRunId);
 }
 return new Set();
}
// Agent changes extend the exact recorded project lineage. Earlier node IDs,
// results and durations remain their own evidence; no old node becomes runnable.
export function continuedWorkflowPlans(s,runId){
 const records=new Map(savedPlanVersions(s).map(p=>[p.runId,p]));if(s.pendingPlan?.runId)records.set(s.pendingPlan.runId,s.pendingPlan);
 const ids=[],seen=new Set([runId]);let p=records.get(runId);
 while(p?.agentIteration&&ids.length<24){const id=p.agentIteration.basis.parentPlanRunId;if(seen.has(id)||!records.has(id))break;ids.unshift(id);seen.add(id);p=records.get(id);}return ids;
}
function withContinuedWorkflow(s,view,options){
 const ancestors=continuedWorkflowPlans(s,view.runId);if(!ancestors.length)return view;
 const old=[],positions={},edges=[];let offset=0,previous=null;
 for(const planId of ancestors){
  const record=savedPlanVersions(s).find(p=>p.runId===planId);if(record?.agentIteration&&!(s.projectBundles||[]).some(b=>sourceMatchesPlan(b,planId)))continue;
  const prior=workflowPresentation(s,planId,{...options,includeHistory:false,includeContinuation:false}),nodes=prior.work.filter(g=>!g.runtime&&!g.observedStage&&!g.branchCandidate&&!g.packageSuggestion),ids=new Set(nodes.map(g=>g.id));
  if(!nodes.length)continue;
  for(const g of nodes){old.push({...g,continuedHistory:true,historyPlanRunId:planId});positions[g.id]=[prior.positions[g.id][0]+offset,prior.positions[g.id][1]];}
  edges.push(...prior.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)));
  const arrived=nodes.find(g=>g.coarseMilestone&&g.milestoneArrived);if(previous&&arrived)edges.push({from:previous.id,to:arrived.id,continuation:true});
  previous=nodes.filter(g=>g.status==='completed'&&!g.runtimeRouteCandidate).at(-1)||previous;
  offset+=Math.max(230,prior.width-230);
 }
 if(!old.length)return view;
 for(const key of Object.keys(view.positions))view.positions[key]=[view.positions[key][0]+offset,view.positions[key][1]];
 const current=s.pendingPlan?.runId===view.runId?s.pendingPlan:(s.planHistory||[]).find(p=>p.runId===view.runId),basis=current?.agentIteration?.basis;
 const source=(s.projectBundles||[]).find(b=>b.revision===basis?.sourceRevision&&[basis.parentPlanRunId,...ancestors].some(id=>sourceMatchesPlan(b,id)));
 const arrived=view.work.find(g=>g.coarseMilestone&&g.milestoneArrived);
 if(previous&&source&&arrived)edges.push({from:previous.id,to:arrived.id,continuation:true});
 view.work.unshift(...old);Object.assign(view.positions,positions);view.edges.unshift(...edges);view.width+=offset;view.continuationOffset=offset;view.height=Math.max(view.height,...old.map(g=>positions[g.id][1]+150));return view;
}

// View-only historical rows: immutable version-qualified IDs never enter active dependencies.
function withHistoricalWorkflow(s,view,options){
 const plans=savedPlanVersions(s);
 const current=plans.findLast(e=>e.runId===view.runId);if(!current)return view;
 const signature=e=>JSON.stringify([e.goal,e.tasks,e.architecture||null]);
 const folded=new Set(visualDraftAncestors(s,view.runId)),visibleHistory=historicalCanvasPlanIds(s,view.runId);
 const seen=new Set([signature(current)]);let y=view.height+10;const rows=[];
 for(const plan of plans){const key=signature(plan);if(plan.runId===view.runId||!visibleHistory.has(plan.runId)||folded.has(plan.runId)||seen.has(key))continue;seen.add(key);
  if(!view.runIds.includes(plan.runId))continue;
  const prior=workflowPresentation(s,plan.runId,{...options,includeHistory:false}),id=x=>'history:'+plan.runId+':'+x;
  const nodes=prior.work.filter(g=>!g.branchCandidate),nodeIds=new Set(nodes.map(g=>g.id));
  const retained=prior.work,top=Math.min(...retained.map(g=>prior.positions[g.id][1])),bottom=Math.max(...retained.map(g=>prior.positions[g.id][1]));
  for(const original of nodes){const g={...original,id:id(original.id),deps:(original.deps||[]).filter(d=>nodeIds.has(d)).map(id),status:'historical',completionAdvance:0,historicalVersion:plan.runId,historicalStatus:original.status,readOnlyHistory:true,historyEvents:workEvents(s,prior,original)};view.work.push(g);view.positions[g.id]=[prior.positions[original.id][0]-(original.completionAdvance||0),prior.positions[original.id][1]-top+y];}
  for(const edge of prior.edges.filter(e=>nodeIds.has(e.from)&&nodeIds.has(e.to)))view.edges.push({...edge,from:id(edge.from),to:id(edge.to),historical:true,active:false});
  // Old proposals remain proposals, not evidence that their tasks ran. Their
  // already-version-qualified identities and readonly detail retain provenance.
  const candidates=prior.work.filter(g=>g.branchCandidate),candidateIds=new Set(candidates.map(g=>g.id));
  for(const original of candidates){view.work.push({...original,status:'proposed',priorPlanCandidate:true,historyEvents:[]});view.positions[original.id]=[prior.positions[original.id][0],prior.positions[original.id][1]-top+y];}
  for(const edge of prior.edges.filter(e=>candidateIds.has(e.from)&&candidateIds.has(e.to)))view.edges.push({...edge,candidate:true,active:false});
  for(const edge of prior.edges.filter(e=>e.decision&&nodeIds.has(e.from)&&candidateIds.has(e.to)))view.edges.push({...edge,from:id(edge.from),candidate:true,active:false});
  rows.push({runId:plan.runId,y});view.width=Math.max(view.width,prior.width);y+=bottom-top+200;
 }
 if(rows.length){view.historyRows=rows;view.height=y-50;}return view;
}

// Candidate paths are view-only proposals, never executable task/run records.
function withBranchCandidates(s,view){
 const generation=(s.events||[]).findLast(e=>e.type==='project.generating'&&e.runId===view.runId&&(!e.sessionId||e.sessionId===s.id));
 const planRunId=generation?.planRunId||view.runId,plan=s.pendingPlan?.runId===planRunId?s.pendingPlan:(s.planHistory||[]).find(p=>p.runId===planRunId);
 if(!plan)return view;
 const activeWork=view.work.filter(g=>!g.branchCandidate&&!g.readOnlyHistory);
 const selected=plan.branchSelection?.optionId||'primary',options=(plan.alternatives||[]).filter(a=>a.id!==selected).map(a=>({...a,completePath:Array.isArray(a.tasks),tasks:Array.isArray(a.tasks)?a.tasks:[{id:a.taskId,title:a.title,instruction:a.instruction,dependencies:[]}]}));
 if(selected!=='primary'&&Array.isArray(plan.branchBaseTasks))options.unshift({id:'primary',title:'Primary planned path',instruction:'Original complete workflow',tasks:plan.branchBaseTasks,completePath:true,rationale:'Original main workflow retained for comparison. Recommendation is not proof of a better outcome.'});
 for(const discovery of s.discoveredBranches||[])if((!discovery.sessionId||discovery.sessionId===s.id)&&discovery.planRunId===planRunId)for(const option of discovery.alternatives||[])options.push({...option,completePath:true,discovery:{runId:discovery.runId,sequence:discovery.sequence,taskId:discovery.taskId,planRevision:discovery.planRevision,baseSourceRevision:discovery.baseSourceRevision}});
 let below=view.height+10,above=80;const rows=[];
 for(const option of options){if(!option.tasks?.length)continue;const prefix='candidate:'+planRunId+':'+(option.discovery?option.discovery.runId+':'+option.discovery.sequence+':':'')+option.id+':',ids=new Set(option.tasks.map(t=>t.id));
  const groups=option.tasks.map(t=>({id:prefix+t.id,runId:view.runId,title:t.title||t.id,taskIds:[],tasks:[{...t,instructions:t.instruction||'',text:t.title||t.id}],deps:(t.dependencies||[]).filter(id=>ids.has(id)).map(id=>prefix+id),status:'proposed',branchCandidate:true,readOnlyCandidate:true,branchOption:option,branchPlanRunId:planRunId,artifactCount:0}));
  const target={id:prefix+'option',runId:view.runId,title:option.title||option.id,status:'proposed',taskIds:[],tasks:[],deps:[],branchCandidate:true,readOnlyCandidate:true,branchOption:option,branchPlanRunId:planRunId,artifactCount:0};
  const depth=new Map(),visit=(g,seen=new Set())=>{if(!g||seen.has(g.id))return 0;if(depth.has(g.id))return depth.get(g.id);const next=new Set(seen).add(g.id),n=g.deps.length?1+Math.max(...g.deps.map(id=>visit(groups.find(x=>x.id===id),next))):0;depth.set(g.id,n);return n;};groups.forEach(g=>visit(g));const layout=layoutWorkflow(groups,target,depth);
  const top=Math.min(...groups.map(g=>layout.positions[g.id][1])),bottom=Math.max(...groups.map(g=>layout.positions[g.id][1]));
  const y=rows.length%2===0?above-200-(bottom-top):below;if(rows.length%2===0)above=y;else below=y+(bottom-top)+200;
  const anchor=activeWork.find(g=>g.tasks.some(t=>(t.backendTaskId||t.workItemId)===option.taskId))||(option.id==='primary'?activeWork[0]:null),offsetX=anchor?view.positions[anchor.id][0]+100:0;
  for(const g of groups){view.work.push(g);view.positions[g.id]=[layout.positions[g.id][0]+offsetX,layout.positions[g.id][1]-top+y];}
  view.edges.push(...groups.flatMap(g=>g.deps.map(from=>({from,to:g.id,candidate:true,active:false}))));
  if(anchor)for(const g of groups.filter(g=>g.deps.length===0))view.edges.push({from:anchor.id,to:g.id,candidate:true,decision:true,active:false,optionId:option.id});
  rows.push({optionId:option.id,runId:view.runId,y});view.width=Math.max(view.width,Math.max(...groups.map(g=>view.positions[g.id][0]))+130);
 }
 if(rows.length){const shift=Math.max(0,80-Math.min(...Object.values(view.positions).map(p=>p[1])));for(const p of Object.values(view.positions))p[1]+=shift;for(const row of rows)row.y+=shift;view.anchorY=80+shift;view.branchRows=rows;view.height=Math.max(...Object.values(view.positions).map(p=>p[1]))+150;}return view;
}

/** Activity is observed run evidence, never inferred from architecture labels. */
export function graphWorkActivity(s,view){
 const live=s?.liveRun,id=live?.runId,events=(s?.events||[]).filter(e=>e.runId===id&&e.sessionId===s.id);
 const result={activeIds:[],label:null};
 if(!id||live.status!=='running'||!events.some(e=>e.type==='run.started')||events.some(e=>['run.completed','run.failed','run.cancelled'].includes(e.type)))return result;
 const control=events.findLast(e=>['run.pause_requested','run.paused','run.resumed'].includes(e.type));
 if(live.interactionMode==='agent'&&live.controlPhase==='paused'&&control?.type==='run.paused'){try{const evidence=safeRunControlEvent(control);if(evidence.planRunId===s.pendingPlan?.runId&&evidence.sourceRevision===(s.pendingPlan?.sourceRevision??null))return {...result,label:'Paused',paused:true};}catch{}}
 const active=(view?.work||[]).filter(g=>!g.readOnlyHistory&&!g.branchCandidate&&['working','running'].includes(g.status)&&(
  g.observedStage&&g.runId===id&&g.events?.some(e=>e.runId===id&&e.sessionId===s.id)||
  g.taskIds?.some(t=>{if(!g.tasks?.some(task=>task.id===t&&task.runId===id))return false;const es=events.filter(e=>e.taskId===t);return es.some(e=>e.type==='task.started')&&!es.some(e=>['task.completed','task.failed'].includes(e.type));})
 ));
 result.activeIds=active.map(g=>g.id);result.label=active.length?'Working · '+active[0].title+(active.length>1?' +'+(active.length-1):''):live.interactionMode==='plan'||live.mode==='plan'?'Planning':'Working';return result;
}
export function renderGraphActivity(activity,esc,{architecture=false,mapped=false}={}){return activity.label?'<span class="graph-work-activity" role="status" title="'+(architecture?(mapped?'Observed task activity; highlighted components are explicit planned targets, not proof of implementation.':'Observed run activity; task-to-component mapping is unavailable. Components are not marked as executing.'):'Observed activity for this session and run.')+'">'+(activity.paused?'<span class="graph-activity-paused" aria-hidden="true"></span>':'<span class="graph-activity-spinner" aria-hidden="true"></span>')+esc(activity.label)+'</span>':'';}

/** Explicit planned targets only; this is not evidence of component implementation. */
export function graphComponentActivity(s,a,activity,view){
 const plan=s?.pendingPlan,live=s?.liveRun;if(!plan||plan.stale||!activity?.activeIds?.length||!a||a.designRunId!==plan.runId)return [];
 const bound=live?.runId===plan.runId||(s.events||[]).some(e=>e.sessionId===s.id&&e.runId===live?.runId&&e.type==='project.generating'&&['staged-artifacts-v1','static-react-packages-v1'].includes(e.strategy)&&e.planRunId===plan.runId);
 if(!bound)return [];
 const known=new Set(a.nodes.filter(n=>!n.readOnlyHistory).map(n=>n.id)),ids=new Set();
 for(const g of view.work||[]){if(!activity.activeIds.includes(g.id)||g.readOnlyHistory||g.branchCandidate)continue;for(const t of g.tasks||[]){const original=plan.tasks?.find(p=>p.id===t.backendTaskId),targets=original?.componentIds;if(!Array.isArray(targets)||targets.length>100||targets.some(id=>typeof id!=='string'||!known.has(id))||new Set(targets).size!==targets.length)continue;for(const id of targets)ids.add(id);}}
 return [...ids];
}

export function packageWorkLabel(s,group){
 if(group?.dynamicWork){
  const rows=(s.events||[]).filter(e=>e.sessionId===s.id&&e.runId===group.runId&&e.workStepId===group.workStepId),end=rows.findLast(e=>e.type==='work.step.completed');
  if(end&&end.meaning==='source_package_compiled'&&rows.some(e=>e.type==='validation.completed'&&e.sourceVerification?.status==='compiled'&&e.sourceVerification.sourceRevision===end.candidateRevision&&JSON.stringify(e.packageBinding)===JSON.stringify(end.packageBinding)))return end.changes?.length?'Source edited · compiled':'Source checked · no changes';
  if(group.status==='working'){
   const active=rows.findLast(e=>e.type==='tool.started'&&!rows.some(x=>['tool.completed','tool.failed'].includes(x.type)&&x.invocationId===e.invocationId));
   return nodeLiveAction(rows);
  }
  return null;
 }
 if(!group||group.readOnlyHistory||group.branchCandidate||group.projectGeneration||!group.projectDraft&&!group.coarseMilestone)return null;
 const ids=new Set(group.taskIds||[]),run=group.tasks?.[0]?.runId;
 const events=(s.events||[]).filter(e=>e.sessionId===s.id&&e.runId===run);
 const seed=events.findLast(e=>e.type==='continuation.seeded');if(seed&&group.tasks?.length&&group.tasks.every(t=>t.status==='retained'&&seed.acceptedEvidence?.some(r=>r.taskId===t.backendTaskId&&r.recordDigest===t.retainedEvidence?.recordDigest)))return 'Retained checked source · not rerun';
 const schemaStart=events.findLast(e=>e.type==='project.generating'&&e.strategy==='trusted-declarative-crud-v1');
 if(schemaStart){const end=events.findLast(e=>ids.has(e.taskId)&&e.type==='task.completed'&&e.meaning==='declarative_schema_validated');if(group.status==='completed'&&end){try{const receipt=safeDeclarativeVerification(end.declarativeVerification,{runId:run,sessionId:s.id,planRunId:schemaStart.planRunId,planRevision:schemaStart.planRevision});if(events.some(e=>e.type==='validation.completed'&&e.taskId===end.taskId&&JSON.stringify(e.declarativeVerification)===JSON.stringify(receipt)))return 'Schema validated · runtime not run';}catch{}}return null;}
 const generation=events.findLast(e=>e.type==='project.generating'&&e.strategy==='static-react-packages-v1');if(!generation)return null;
 const scoped=events.filter(e=>ids.has(e.taskId)),end=scoped.findLast(e=>['task.completed','task.failed'].includes(e.type));
 const phase=events.findLast(e=>['run.paused','run.resumed'].includes(e.type));if(['working','running'].includes(group.status)&&phase?.type==='run.paused')return 'Paused at safe boundary';const liveAction=['working','running'].includes(group.status)&&nodeLiveAction(scoped);if(liveAction)return liveAction;
 const route=events.findLast(e=>e.type==='work.route.started'&&ids.has(e.taskId)),assessed=route&&events.some(e=>e.type==='work.route.assessed'&&e.decisionId===route.decisionId&&e.sequence>route.sequence);if(generation.adaptiveWorkVersion===3&&route&&!assessed&&['working','running'].includes(group.status))return 'Exploring options · waiting for Muse';
 if(group.status==='completed'&&end?.type==='task.completed'&&end.meaning==='source_package_compiled'&&/^[a-f0-9]{64}$/.test(end.candidateRevision||'')){
  const checked=scoped.findLast(e=>e.type==='validation.completed'&&e.sourceVerification?.status==='compiled'&&e.sourceVerification.sourceRevision===end.candidateRevision);
  if(checked){try{const receipt=safeSourceVerification(checked.sourceVerification,{runId:run,sessionId:s.id,planRunId:generation.planRunId,planRevision:generation.planRevision});const taskId=end.taskId.startsWith(run+':')?end.taskId.slice(run.length+1):end.taskId;if(receipt.status==='compiled'&&JSON.stringify(safePackageBinding(checked.packageBinding,taskId))===JSON.stringify(safePackageBinding(end.packageBinding,taskId)))return 'Compiled · browser unverified';}catch{}}
 }
 if(!['working','running'].includes(group.status)||s.liveRun?.runId!==run||s.liveRun.status!=='running'||end)return null;
 if(generation.adaptiveWorkflow&&scoped.findLast(e=>e.type==='work.step.completed')?.sequence>(scoped.findLast(e=>e.type==='work.step.started')?.sequence||0))return 'At a work boundary';
 const event=scoped.findLast(e=>e.type==='package.progress');if(!event||![0,1].includes(event.attempt)||event.execution!=='not_run'||event.tests!=='not_run'||event.verified!==false)return null;
 try{safePackageProgress(event);}catch{return null;}
 return ({authored:'Source authored · checking next',checking:'Checking source',repairing:'Repairing source'})[event.phase]||null;
}

// Each displayed branch comes from a validated real package-options event.
// It remains an unexecuted proposal until a new requested goal is actually built.
export function withPackageChoiceBranches(s,view){
 const ids=new Set(view.work.map(g=>g.id));let y=view.height+50;
 for(const event of s.events||[]){
  if(event.type!=='package.options'||event.sessionId!==s.id||event.planRunId!==s.pendingPlan?.runId)continue;
  try{validatePackageOptionsOrigin(event,s.events||[]);}catch{continue;}
  const anchor=view.work.find(g=>!g.branchCandidate&&g.taskIds.includes(event.taskId));if(!anchor)continue;
  for(const option of event.options){const id='package-choice:'+event.optionSetId+':'+option.id;if(ids.has(id))continue;ids.add(id);
   const g={id,runId:event.runId,title:option.label,status:'proposed',tasks:[],taskIds:[],deps:[],artifactCount:0,branchCandidate:true,readOnlyCandidate:true,branchOption:{recommended:option.recommendation},packageSuggestion:{event,option}};
   view.work.push(g);view.positions[id]=[view.positions[anchor.id][0]+230,y];y+=170;view.edges.push({from:anchor.id,to:id,candidate:true,decision:true,active:false,optionId:option.id});view.width=Math.max(view.width,view.positions[id][0]+150);
  }
 }
 if(y>view.height+50)view.height=y+30;return view;
}
