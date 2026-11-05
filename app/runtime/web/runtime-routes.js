const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),txt=(x,n)=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x),obj=x=>x&&typeof x==='object'&&!Array.isArray(x),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=()=>{throw Error('Invalid runtime route evidence');};
const taskId=e=>String(e.taskId||'').replace(e.runId+':','');
export const RUNTIME_ROUTE_TYPES=new Set(['milestone.arrived','work.route.started','work.route.assessed','work.route.candidates','work.route.steered','work.route.selected']);
export function safeRuntimeRoute(route,hasSource){
 if(!obj(route)||Object.keys(route).sort().join(',')!=='candidates,requiresChoice,status,summary,version'||route.version!==1||!['continue','milestone_complete','needs_input'].includes(route.status)||!txt(route.summary,600)||typeof route.requiresChoice!=='boolean'||!Array.isArray(route.candidates))fail();
 if(route.status==='milestone_complete'&&(!hasSource||route.requiresChoice))fail();
 if(route.status!=='continue'){if(route.candidates.length)fail();return structuredClone(route);}
 if(route.candidates.length<2||route.candidates.length>4||new Set(route.candidates.map(c=>c.title?.toLowerCase())).size!==route.candidates.length||route.candidates.filter(c=>c.recommended===true).length!==1)fail();
 route.candidates.forEach((c,i)=>{if(!obj(c)||Object.keys(c).sort().join(',')!=='id,instruction,rationale,recommended,title,tradeoff'||c.id!=='c'+(i+1)||!txt(c.title,100)||!txt(c.instruction,2000)||!txt(c.rationale,500)||!txt(c.tradeoff,500)||typeof c.recommended!=='boolean')fail();});return structuredClone(route);
}
export function runtimeRouteEventFields(e,history=[]){
 const custom=RUNTIME_ROUTE_TYPES.has(e.type);if(!custom&&e.routeDecisionId===undefined)return {};
 const task=taskId(e),rows=history.filter(x=>x.runId===e.runId&&(!x.sessionId||x.sessionId===e.sessionId)&&x.sequence<e.sequence),own=x=>taskId(x)===task;
 if(!/^t[1-9][0-9]*$/.test(task)||!rows.some(x=>x.type==='project.generating'&&x.adaptiveWorkVersion===3)||rows.some(x=>['run.completed','run.failed','run.cancelled'].includes(x.type)))fail();
 if(e.type!=='work.route.steered'&&e.agentId!==e.runId+':worker:'+task)fail();
 if(e.type==='milestone.arrived'){
  if(!(e.parentCandidateRevision===null||hex(e.parentCandidateRevision))||!(e.fromWorkStepId===null||typeof e.fromWorkStepId==='string'&&/^t[1-9][0-9]*\.s[1-9][0-9]?$/.test(e.fromWorkStepId))||rows.some(x=>x.type===e.type&&own(x))||!rows.some(x=>x.type==='task.started'&&own(x)))fail();
  if(e.fromWorkStepId!==null&&!rows.some(x=>x.type==='work.step.completed'&&x.workStepId===e.fromWorkStepId&&x.candidateRevision===e.parentCandidateRevision))fail();return {fromWorkStepId:e.fromWorkStepId,parentCandidateRevision:e.parentCandidateRevision};
 }
 const id=custom?e.decisionId:e.routeDecisionId;if(typeof id!=='string'||!new RegExp('^'+task+'\\.r[1-9][0-9]?$').test(id))fail();
 if(!custom){if(!rows.some(x=>x.type==='work.route.started'&&own(x)&&x.decisionId===id)||rows.some(x=>x.type==='work.route.assessed'&&own(x)&&x.decisionId===id))fail();let repair={};if(e.routeRepair!==undefined){const r=e.routeRepair,d=r?.diagnostic;if(e.type!=='tool.started'||!obj(r)||Object.keys(r).sort().join(',')!=='attempt,code,diagnostic'||r.attempt!==1||!['runtime_route_invalid','runtime_route_source_required','runtime_route_alternatives_required','runtime_route_recommendation_required'].includes(r.code)||d!==null&&(!obj(d)||Object.keys(d).some(k=>!['field','reason','maxLength'].includes(k))||typeof d.field!=='string'||!/^[-a-zA-Z0-9_.]{1,100}$/.test(d.field)||typeof d.reason!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(d.reason)||d.maxLength!==undefined&&(!Number.isSafeInteger(d.maxLength)||d.maxLength<1||d.maxLength>2000)))fail();repair={routeRepair:structuredClone(r)};}return {routeDecisionId:id,...repair};}
 if(typeof e.plannedWorkStepId!=='string'||!new RegExp('^'+task+'\\.s[1-9][0-9]?$').test(e.plannedWorkStepId))fail();
 const out={decisionId:id,plannedWorkStepId:e.plannedWorkStepId};
 if(e.type==='work.route.steered'){
  const available=rows.findLast(x=>x.type==='work.route.candidates'&&own(x)&&x.decisionId===id),phase=rows.findLast(x=>['run.paused','run.resumed'].includes(x.type));
  if(!available||available.routeDigest!==e.routeDigest||available.plannedWorkStepId!==e.plannedWorkStepId||!available.route.candidates.some(c=>c.id===e.candidateId)||phase?.type!=='run.paused'||rows.some(x=>x.type==='work.route.selected'&&own(x)&&x.decisionId===id)||e.selectionActor!=='user'||typeof e.edited!=='boolean'||!txt(e.title,100)||!txt(e.instruction,2000))fail();
  return {...out,routeDigest:e.routeDigest,candidateId:e.candidateId,title:e.title,instruction:e.instruction,selectionActor:'user',edited:e.edited,execution:'not_run'};
 }
 if(!(e.parentCandidateRevision===null||hex(e.parentCandidateRevision)))fail();out.parentCandidateRevision=e.parentCandidateRevision;
 if(e.type==='work.route.started'){if(rows.some(x=>x.type===e.type&&own(x)&&x.decisionId===id)||!rows.some(x=>x.type==='milestone.arrived'&&own(x)))fail();return out;}
 const start=rows.find(x=>x.type==='work.route.started'&&own(x)&&x.decisionId===id);if(!start||start.plannedWorkStepId!==e.plannedWorkStepId||start.parentCandidateRevision!==e.parentCandidateRevision)fail();
 if(e.type==='work.route.assessed'){
  if(rows.some(x=>x.type===e.type&&own(x)&&x.decisionId===id)||!rows.some(x=>x.type==='model.response'&&own(x)&&x.routeDecisionId===id)||!rows.some(x=>x.type==='tool.completed'&&own(x)&&x.routeDecisionId===id))fail();return {...out,route:safeRuntimeRoute(e.route,e.parentCandidateRevision!==null)};
 }
 const assessment=rows.findLast(x=>x.type==='work.route.assessed'&&own(x)&&x.decisionId===id);if(!assessment)fail();
 if(e.type==='work.route.candidates'){if(!hex(e.routeDigest)||assessment.route.status!=='continue'||!same(e.route,assessment.route)||rows.some(x=>x.type===e.type&&own(x)&&x.decisionId===id))fail();return {...out,route:safeRuntimeRoute(e.route,e.parentCandidateRevision!==null),routeDigest:e.routeDigest};}
 if(e.type==='work.route.selected'){
  if(!txt(e.title,100)||!txt(e.instruction,2000)||typeof e.edited!=='boolean'||rows.some(x=>x.type===e.type&&own(x)&&x.decisionId===id))fail();
  if(e.selectionActor==='source_check'){if(assessment.route.status!=='milestone_complete'||e.candidateId!==null||e.routeDigest!==null||e.edited)fail();}
  else{
   const available=rows.findLast(x=>x.type==='work.route.candidates'&&own(x)&&x.decisionId===id),candidate=available?.route.candidates.find(c=>c.id===e.candidateId);if(!candidate||e.routeDigest!==available.routeDigest)fail();
   if(e.selectionActor==='model_recommendation'){if(!candidate.recommended||e.edited||e.title!==candidate.title||e.instruction!==candidate.instruction)fail();}
   else if(e.selectionActor==='user'){const steered=rows.findLast(x=>x.type==='work.route.steered'&&own(x)&&x.decisionId===id);if(!steered||['candidateId','title','instruction','edited','routeDigest'].some(k=>steered[k]!==e[k]))fail();}else fail();
  }
  return {...out,candidateId:e.candidateId,routeDigest:e.routeDigest,title:e.title,instruction:e.instruction,selectionActor:e.selectionActor,edited:e.edited};
 }
 fail();
}
// Project only recorded route choices. Coarse planning dependencies remain
// constraints in the approved Plan, never speculative traversal edges.
export function applyRuntimeWorkflow(s,work){
 const markers=(s.events||[]).filter(e=>e.type==='project.generating'&&e.adaptiveWorkVersion===3&&e.sessionId===s.id),runs=new Set(markers.map(e=>e.runId));
 let enabled=false;
 const p=s.pendingPlan,hasBuild=p&&(s.events||[]).some(e=>e.type==='project.generating'&&e.planRunId===p.runId);
 if((p?.documentPlanningContract==='document-design-v1'||p?.agentIteration?.version===1)&&!hasBuild){for(const g of work){if(g.readOnlyHistory||g.projectGeneration||g.branchCandidate)continue;if(g.tasks?.some(t=>t.runId===p.runId&&/^t[1-9][0-9]*$/.test(t.backendTaskId||String(t.id).replace(p.runId+':','')))){g.coarseMilestone=true;g.milestoneArrived=false;g.deps=[];enabled=true;}}}
 for(const run of runs){
  const rows=(s.events||[]).filter(e=>e.runId===run&&e.sessionId===s.id),parents=work.filter(g=>!g.readOnlyHistory&&!g.projectGeneration&&!g.branchCandidate&&g.tasks?.some(t=>t.runId===run&&/^t[1-9][0-9]*$/.test(t.backendTaskId||String(t.id).replace(run+':',''))));if(!parents.length)continue;enabled=true;
  const byTask=new Map();for(const g of parents){g.coarseMilestone=true;g.milestoneArrived=false;g.deps=[];for(const t of g.tasks)byTask.set(t.backendTaskId||String(t.id).replace(run+':',''),g);}
  const stepNodes=new Map(),additions=[],runStatus=s.liveRun?.runId===run?s.liveRun.status:s.runs?.find(x=>x.id===run)?.status;
  const sourceStatus=(id,start,end)=>end?'completed':start?(runStatus==='running'?'working':runStatus==='failed'?'failed':runStatus==='cancelled'?'cancelled':'interrupted'):'ready';
  const priorStep=(task,sequence)=>rows.findLast(x=>x.type==='work.step.completed'&&taskId(x)===task&&x.sequence<sequence)?.workStepId;
  const sourceNode=(selection,id,base)=>{const task=taskId(selection),workStepId=selection.plannedWorkStepId,events=rows.filter(e=>e.workStepId===workStepId),start=events.find(e=>e.type==='work.step.started'),end=events.find(e=>e.type==='work.step.completed'),noChange=end&&!end.changes?.length,title=noChange?'Check: '+selection.title.replace(/^Check\s+/i,''):selection.title,status=sourceStatus(workStepId,start,end),t={id:run+':'+workStepId,backendTaskId:workStepId,runId:run,title,text:title,instructions:selection.instruction,status,deps:[],workStepId};
   const g={id,key:id,runId:run,title,status,dynamicWork:true,workStepId,parentGroupId:byTask.get(task)?.id,taskIds:[t.id],tasks:[t],deps:[base],artifactCount:0,events,workResultKind:end?(noChange?'source_check':'source_edit'):null,routeSelection:selection};stepNodes.set(workStepId,id);return g;};
  for(const e of rows.filter(e=>e.type==='work.route.candidates'||e.type==='work.route.selected'&&e.selectionActor==='source_check')){
   const task=taskId(e),parent=byTask.get(task);if(!parent)continue;const previous=priorStep(task,e.sequence),base=stepNodes.get(previous)||parent.id;
   if(e.type==='work.route.selected'){additions.push(sourceNode(e,run+':work-step:'+e.plannedWorkStepId,base));continue;}
   const selected=rows.find(x=>x.type==='work.route.selected'&&x.decisionId===e.decisionId&&taskId(x)===task),steered=rows.findLast(x=>x.type==='work.route.steered'&&x.decisionId===e.decisionId&&taskId(x)===task);
   for(const c of e.route.candidates){const id=run+':route:'+e.decisionId+':'+c.id;
    if(selected?.candidateId===c.id){const g=sourceNode(selected,id,base);g.routeProposal={event:e,candidate:c};additions.push(g);}
    else{const edited=steered?.candidateId===c.id?steered:null;additions.push({id,key:id,runId:run,title:edited?.title||c.title,status:'proposed',runtimeRouteCandidate:true,branchCandidate:true,readOnlyCandidate:!!selected,taskIds:[],tasks:[],deps:[base],artifactCount:0,parentGroupId:parent.id,routeProposal:{event:e,candidate:{...c,...(edited?{title:edited.title,instruction:edited.instruction}:{})},selected,steered:edited},branchOption:{recommended:c.recommended}});}
   }
  }
  for(const e of rows.filter(e=>e.type==='milestone.arrived')){const parent=byTask.get(taskId(e));if(parent){parent.milestoneArrived=true;parent.deps=e.fromWorkStepId&&stepNodes.has(e.fromWorkStepId)?[stepNodes.get(e.fromWorkStepId)]:[];}}
  const published=rows.some(e=>e.type==='project.generated'),last=rows.findLast(e=>e.type==='work.step.completed'),lastId=stepNodes.get(last?.workStepId);
  for(let i=work.length-1;i>=0;i--){const g=work[i];if(g.projectGeneration&&g.tasks?.some(t=>t.runId===run)){if(!published)work.splice(i,1);else g.deps=lastId?[lastId]:[];}}
  work.push(...additions);
 }
 return enabled;
}
export function pendingRuntimeRoute(s,group){const p=group?.routeProposal;if(!p||p.selected||s.liveRun?.runId!==p.event.runId||s.liveRun.status!=='running')return null;const latest=(s.events||[]).findLast(e=>e.runId===p.event.runId&&e.type==='work.route.candidates');if(latest?.decisionId!==p.event.decisionId||latest.routeDigest!==p.event.routeDigest||(s.events||[]).some(e=>e.runId===p.event.runId&&e.type==='work.route.selected'&&e.decisionId===p.event.decisionId))return null;return{event:p.event,candidate:p.candidate};}
export function renderRuntimeRouteDetails(s,group,esc){
 const p=group.routeProposal,{event,candidate}=p,latest=(s.events||[]).findLast(e=>e.runId===event.runId&&e.type==='work.route.candidates'),phase=(s.events||[]).findLast(e=>e.runId===event.runId&&['run.paused','run.resumed'].includes(e.type)),pending=!!pendingRuntimeRoute(s,group),paused=phase?.type==='run.paused';
 const attrs=' data-route-session="'+esc(s.id)+'" data-route-run="'+esc(event.runId)+'" data-route-decision="'+esc(event.decisionId)+'"';
 const actions=!pending?'':'<div class="route-actions"><button type="button" data-route-steer="'+esc(candidate.id)+'"'+attrs+' title="Select this route at the safe boundary, then continue the same Build">Steer</button>'+(paused?'<button type="button" data-route-edit="'+esc(candidate.id)+'"'+attrs+'>Edit node</button>':'')+'</div>';
 return '<section class="progress-panel compact-progress" aria-label="Candidate route"><header class="detail-header"><div class="detail-heading"><div class="detail-eyebrow">'+(p.selected?'Not selected · not run':candidate.recommended?'Recommended · not run':'Alternative · not run')+'</div><h2>'+esc(candidate.title)+'</h2></div><button class="detail-close" data-action="close-work" aria-label="Close work details">×</button></header><div class="detail-body"><p>'+esc(candidate.rationale)+'</p><h3>Tradeoff</h3><p>'+esc(candidate.tradeoff)+'</p>'+actions+'<small>Model assessment · alternatives not executed</small></div></section>';
}
