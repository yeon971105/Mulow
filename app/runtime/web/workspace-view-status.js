import {agentIterationMatchesDocument} from './agent-iteration.js';
import {validatePlanDocument} from './plan-document.js';
import {planDocumentEventFields,validateDocumentDesignView} from './plan-document-events.js';

const rev=x=>typeof x==='string'&&/^plandoc_[A-Za-z0-9-]{1,100}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const run=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]{1,100}$/.test(x);
const mark=(tone,label)=>({tone,label});
function validDocument(current){try{return !!current&&rev(current.revisionId)&&hash(current.documentDigest)&&!!validatePlanDocument(current.document);}catch{return false;}}
function currentDesign(session,state){
 const d=state.design,c=state.current;if(session.pendingPlan?.agentIteration)return session.pendingPlan.stale!==true&&agentIterationMatchesDocument(session.pendingPlan,c)&&session.architecture?.designRunId===session.pendingPlan.runId;if(!d||d.historical===true||!run(d.runId)||d.approved!==false||d.revisionId!==c?.revisionId||d.documentDigest!==c?.documentDigest||session.pendingPlan?.stale===true)return false;
 try{const p=validateDocumentDesignView(d.plan),b=p.documentBinding;if(b.revisionId!==c.revisionId||b.documentDigest!==c.documentDigest||JSON.stringify(p.planDocument)!==JSON.stringify(c.document)||JSON.stringify(d.documentBinding)!==JSON.stringify(b))return false;const selected=session.pendingPlan;return !selected||(selected.runId===d.runId&&selected.documentBinding?.revisionId===c.revisionId&&selected.documentBinding?.documentDigest===c.documentDigest);}catch{return false;}
}
function admittedRun(session,state){
 const live=session.liveRun;if(!run(live?.runId))return null;
 const events=(session.events||[]).filter(e=>e.sessionId===session.id&&e.runId===live.runId&&e.historical!==true),start=events.find(e=>e.type==='run.started');if(!start)return null;
 try{const marker=planDocumentEventFields(start).documentPlan;if(!marker)return null;const revision=state.current?.revisionId||null;if(marker.action==='design'&&marker.revisionId!==revision||marker.action==='author'&&marker.baseRevisionId!==revision)return null;return {live,events,marker};}catch{return null;}
}

// Coherent saved design evidence is independent of the displayed Build outcome.
export function currentDocumentDesignReady(session={},state={}){return state.sessionId===session.id&&state.phase==='ready'&&state.busy!==true&&state.editing!==true&&validDocument(state.current)&&currentDesign(session,state);}
function boundBuild(session){
 const live=session.liveRun,p=session.pendingPlan;if(!run(live?.runId)||!run(p?.runId))return null;
 const events=(session.events||[]).filter(e=>e.sessionId===session.id&&e.runId===live.runId&&e.historical!==true),start=events.find(e=>e.type==='run.started'&&e.interactionMode==='agent'&&!e.documentPlan);
 const generating=events.find(e=>e.type==='project.generating'&&e.planRunId===p.runId&&hash(e.planRevision)&&start&&Number.isInteger(start.sequence)&&e.sequence>start.sequence);
 if(!generating)return null;
 const terminal=events.findLast(e=>['run.completed','run.failed','run.cancelled'].includes(e.type)&&e.sequence>generating.sequence);
 return {live,terminal};
}

// Observations only: these marks never grant source, model, design or Build authority.
// Server status is the evidence of an applied coherent pair; a proposed/partial stage is not ready.
export function workspaceViewStatus(session={},documentState={},previewMark={tone:'stopped',label:'Preview stopped'}){
 const scoped=documentState.sessionId===session.id,state=scoped?documentState:{},saved=scoped&&validDocument(state.current),d=state.design;
 const out={plan:mark('pending','Plan \u00b7 not created'),architecture:mark('pending','Architecture \u00b7 not generated'),workflow:mark('pending','Workflow \u00b7 not generated'),preview:previewMark};
 if(!scoped)return out;
 const admitted=admittedRun(session,state);
 if(saved)out.plan=mark('ready','Plan \u00b7 saved document');
 if(state.phase==='idle'||state.phase==='loading')out.plan=mark('pending','Plan \u00b7 confirming saved document');
 if(state.phase==='error'&&admitted?.marker.action!=='design')out.plan=mark('error','Plan \u00b7 status or latest change unconfirmed');
 if(state.editing)out.plan=mark('stale','Plan \u00b7 unsaved changes');
 const prior=!!(d||session.pendingPlan?.architecture||session.architecture||session.workflow?.tasks?.length),unconfirmed=state.phase==='idle'||state.phase==='loading'||state.phase==='error';
 if(prior){out.architecture=mark('stale','Architecture \u00b7 previous design; current version unconfirmed');out.workflow=mark('stale','Workflow \u00b7 previous design; current version unconfirmed');}
 if(saved&&!unconfirmed&&!state.editing&&currentDesign(session,state)){
  out.architecture=mark('ready','Architecture \u00b7 current design ready; Build not implied');
  out.workflow=mark('ready','Workflow \u00b7 current design ready; Build not implied');
 }
 if(admitted){
  const {live,events,marker}=admitted,terminal=events.findLast(e=>['run.completed','run.failed','run.cancelled'].includes(e.type)),cancelled=live.status==='cancelled'||terminal?.type==='run.cancelled',failed=['failed','cancelled','interrupted'].includes(live.status)||terminal&&terminal.type!=='run.completed';
  const active=live.status==='running'&&!terminal,settling=live.status==='completed'&&state.busy===true;
  if(marker.action==='author'){
   if(active||settling)out.plan=mark('working',settling?'Plan \u00b7 saving authored document':'Plan \u00b7 authoring');
   else if(failed)out.plan=mark('error','Plan \u00b7 latest authoring failed or cancelled; saved version retained');
   else if(state.phase==='authoring')out.plan=mark('pending','Plan \u00b7 awaiting confirmed authoring status');
  }else{
   const matches=e=>e.documentBinding?.revisionId===state.current?.revisionId&&e.documentBinding?.documentDigest===state.current?.documentDigest;
   const partial=events.find(e=>e.type==='plan.design.stage'&&e.stage==='architecture'&&matches(e)),proposed=events.find(e=>e.type==='plan.design.proposed'&&matches(e)),blocked=events.find(e=>e.type==='plan.design.blocked'&&matches(e));
   const started=stage=>events.some(e=>e.type==='tool.started'&&e.name==='model.chat.completions'&&e.inputSummary==='document '+stage+' tool');
   const indexStarted=started('index'),architectureStarted=started('architecture'),workflowStarted=started('workflow'),waiting=prior?'stale':'pending';
   if(failed||blocked||state.phase==='error'){
    // Attribute failure to the stage actually dispatched. Downstream work is waiting.
    if(workflowStarted){out.architecture=mark(partial?'stale':waiting,partial?'Architecture \u00b7 stage returned; coherent design not applied':'Architecture \u00b7 current design unconfirmed');out.workflow=mark(cancelled?'stale':'error',cancelled?'Workflow \u00b7 generation cancelled':'Workflow \u00b7 generation or apply failed');}
    else if(architectureStarted){out.architecture=mark(cancelled?'stale':'error',cancelled?'Architecture \u00b7 generation cancelled':'Architecture \u00b7 generation failed');out.workflow=mark(waiting,'Workflow \u00b7 not started; waiting for architecture');}
    else{if(indexStarted||blocked)out.plan=mark(blocked||cancelled?'stale':'error',blocked?'Plan \u00b7 document needs clarification':cancelled?'Plan \u00b7 indexing cancelled; document retained':'Plan \u00b7 indexing failed; document retained');out.architecture=mark(waiting,'Architecture \u00b7 not started; waiting for document index');out.workflow=mark(waiting,'Workflow \u00b7 not started; waiting for design');}
   }else if(settling||proposed&&active){out.architecture=mark('working','Architecture \u00b7 saving coherent design');out.workflow=mark('working','Workflow \u00b7 validating and saving coherent design');}
   else if(active){
    out.architecture=mark(architectureStarted&&!partial?'working':'pending',partial?'Architecture \u00b7 stage complete; waiting for coherent design':architectureStarted?'Architecture \u00b7 generating':'Architecture \u00b7 waiting for document index');
    out.workflow=mark(workflowStarted?'working':'pending',workflowStarted?'Workflow \u00b7 generating':'Workflow \u00b7 waiting for architecture');
    if(indexStarted&&!architectureStarted&&!partial)out.plan=mark('working','Plan \u00b7 indexing the saved document');
   }
  }
 }
 if(state.busy&&state.phase==='authoring'&&!admitted)out.plan=mark('pending','Plan \u00b7 waiting for authoring to start');
 if(state.busy&&state.phase==='generating'&&!admitted){out.architecture=mark('pending','Architecture \u00b7 waiting for generation to start');out.workflow=mark('pending','Workflow \u00b7 waiting for generation to start');}
 if(state.editing){out.architecture=mark(prior?'stale':'pending',prior?'Architecture \u00b7 Plan has unsaved changes':'Architecture \u00b7 not generated');out.workflow=mark(prior?'stale':'pending',prior?'Workflow \u00b7 Plan has unsaved changes':'Workflow \u00b7 not generated');}
 const build=boundBuild(session);
 if(build&&build.live.status==='running'&&!build.terminal)out.workflow=build.live.controlPhase==='paused'?mark('pending','Workflow \u00b7 Build paused'):mark('working',build.live.controlPhase==='draining'?'Workflow \u00b7 Build pausing after current work':'Workflow \u00b7 Build in progress');
 else if(build&&currentDocumentDesignReady(session,state)){
  if(build.terminal?.type==='run.failed')out.workflow=mark('error','Workflow \u00b7 Build failed; review to retry');
  else if(build.terminal?.type==='run.cancelled')out.workflow=mark('stale','Workflow \u00b7 Build cancelled; review to retry');
  else if(build.live.status==='completed'&&build.terminal?.type==='run.completed')out.workflow=mark('ready','Workflow \u00b7 design ready; Build completed, runtime tests unverified');
 }
 return out;
}

// Presentation uses state across all views. It never changes admission tones.
export function workspaceViewIndicator(observation={}){
 const {tone,label=''}=observation;
 if(tone==='working')return {status:'running',name:'In progress',glyph:'',spinning:true};
 if(tone==='error')return {status:'error',name:'Needs attention',glyph:'',spinning:false};
 if(tone==='ready'){
  const complete=/^Plan .*saved document|^Architecture .*current design ready|^Workflow .*Build completed/.test(label);
  return complete?{status:'success',name:'Stage complete',glyph:'',spinning:false}:{status:'ready',name:'Ready',glyph:'',spinning:false};
 }
 if(tone==='stale'||tone==='preparing')return {status:'review',name:'Needs review',glyph:'',spinning:false};
 return {status:'idle',name:'Idle or waiting',glyph:'',spinning:false};
}
