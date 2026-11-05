const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),txt=(x,n)=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=n;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x),fail=()=>{throw Error('Invalid runtime work evidence');};
const parentId=e=>String(e.taskId||'').replace(e.runId+':','');
export function validWorkStepId(id,task){return typeof id==='string'&&new RegExp('^'+task+'\\.s[1-9][0-9]?$').test(id);}
export function safeAdaptiveWorkFields(e,history=[]){
 if(e.type==='project.generating'&&e.adaptiveWorkflow!==undefined){if(e.adaptiveWorkflow!==true||e.strategy!=='static-react-packages-v1'||e.adaptiveWorkVersion!==undefined&&![1,2,3].includes(e.adaptiveWorkVersion))fail();if(e.adaptiveWorkVersion===3&&!history.some(x=>x.runId===e.runId&&x.type==='run.started'&&x.strategyAdmission?.runtimeBranchingVersion===1))fail();return {adaptiveWorkflow:true,...(e.adaptiveWorkVersion?{adaptiveWorkVersion:e.adaptiveWorkVersion}:{})};}
 const custom=['work.step.started','work.refined','work.step.completed'].includes(e.type);
 if(!custom&&e.workStepId===undefined)return {};
 const task=parentId(e),same=x=>x.runId===e.runId&&(!x.sessionId||x.sessionId===e.sessionId)&&x.sequence<e.sequence,rows=history.filter(same);
 if(!/^t[1-9][0-9]*$/.test(task)||!validWorkStepId(e.workStepId,task)||e.agentId!==e.runId+':worker:'+task||!rows.some(x=>x.type==='project.generating'&&x.adaptiveWorkflow===true)||rows.some(x=>['run.completed','run.failed','run.cancelled'].includes(x.type)))fail();
 const own=x=>x.workStepId===e.workStepId&&parentId(x)===task;
 if(!custom){if(!rows.some(x=>x.type==='work.step.started'&&own(x))||rows.some(x=>x.type==='work.step.completed'&&own(x)))fail();return {workStepId:e.workStepId};}
 if(!txt(e.title,100))fail();const out={workStepId:e.workStepId,title:e.title};
 if(e.type==='work.step.started'){
  if(!txt(e.instruction,2000)||!(e.parentCandidateRevision===null||hex(e.parentCandidateRevision))||rows.some(x=>x.type==='work.step.started'&&own(x)))fail();
  const discovered=rows.findLast(x=>x.type==='work.refined'&&parentId(x)===task)?.next||[];
  const runtime=rows.some(x=>x.type==='project.generating'&&x.adaptiveWorkVersion===3);
  if(runtime){if(!rows.some(x=>x.type==='work.route.selected'&&parentId(x)===task&&x.plannedWorkStepId===e.workStepId&&x.title===e.title&&x.instruction===e.instruction&&x.parentCandidateRevision===e.parentCandidateRevision))fail();}
  else if(e.workStepId!==task+'.s1'&&!discovered.some(x=>x.workStepId===e.workStepId&&x.title===e.title&&x.instruction===e.instruction))fail();
  return {...out,instruction:e.instruction,parentCandidateRevision:e.parentCandidateRevision};
 }
 const proof=rows.findLast(x=>x.type==='validation.completed'&&own(x)&&x.sourceVerification?.status==='compiled'&&x.sourceVerification.sourceRevision===e.candidateRevision&&JSON.stringify(x.packageBinding)===JSON.stringify(e.packageBinding));
 if(!proof||!rows.some(x=>x.type==='work.step.started'&&own(x)))fail();
 if(e.type==='work.refined'){
  if(JSON.stringify(proof.packageCheckpoint)!==JSON.stringify(e.packageCheckpoint)||!Array.isArray(e.next)||e.next.length>48||new Set(e.next.map(x=>x.workStepId)).size!==e.next.length||e.next.some(x=>!plain(x)||Object.keys(x).sort().join(',')!=='id,instruction,title,workStepId'||!validWorkStepId(x.workStepId,task)||x.workStepId!==task+'.'+x.id||!txt(x.title,100)||!txt(x.instruction,2000)||rows.some(p=>p.type==='work.step.started'&&p.workStepId===x.workStepId)))fail();
  return {...out,next:structuredClone(e.next)};
 }
 if(!rows.some(x=>x.type==='work.refined'&&own(x))||rows.some(x=>x.type===e.type&&own(x))||!Array.isArray(e.changes)||e.changes.length>2||new Set(e.changes.map(x=>x.path)).size!==e.changes.length)fail();
 for(const f of e.changes)if(!plain(f)||Object.keys(f).sort().join(',')!=='bytes,change,path,sha256'||!['created','changed'].includes(f.change)||!proof.sourceVerification.inputs.some(p=>p.path===f.path&&p.sha256===f.sha256&&p.bytes===f.bytes))fail();
 return {...out,changes:structuredClone(e.changes)};
}
// Only persisted runtime discoveries can add intermediate graph nodes.
export function addAdaptiveWorkGroups(s,work){
 const additions=[];
 for(const parent of [...work]){
  const tasks=parent.tasks||[];if(!tasks.length||parent.readOnlyHistory||tasks.some(t=>(s.events||[]).some(e=>e.type==='project.generating'&&e.runId===t.runId&&e.adaptiveWorkVersion===3)))continue;
  const origins=new Set(tasks.map(t=>t.id)),rows=(s.events||[]).filter(e=>e.sessionId===s.id&&origins.has(e.taskId));
  const starts=rows.filter(e=>e.type==='work.step.started'),discovered=rows.filter(e=>e.type==='work.refined').flatMap(e=>e.next||[]),items=new Map();
  for(const d of discovered)items.set(d.workStepId,{...d});for(const e of starts)items.set(e.workStepId,{...(items.get(e.workStepId)||{}),title:e.title,instruction:e.instruction});
  for(const e of rows.filter(e=>e.type==='work.refined'))items.set(e.workStepId,{...(items.get(e.workStepId)||{}),title:e.title});
  let previous=null;
  for(const [workStepId,item] of [...items].sort((a,b)=>Number(a[0].split('.s')[1])-Number(b[0].split('.s')[1]))){
   const events=rows.filter(e=>e.workStepId===workStepId),start=events.find(e=>e.type==='work.step.started'),end=events.find(e=>e.type==='work.step.completed'),run=tasks[0].runId;
   const id=run+':work-step:'+workStepId,status=end?'completed':start?(s.liveRun?.runId===run&&s.liveRun.status==='running'?'working':s.runs?.find(r=>r.id===run)?.status==='cancelled'?'cancelled':s.runs?.find(r=>r.id===run)?.status==='failed'?'failed':'interrupted'):'ready';
   const noChange=!!end&&!end.changes?.length,displayTitle=noChange?'Check: '+item.title.replace(/^(Verify|Check)\s+/i,'').replace(/\s+(complete|completed|established)$/i,''):item.title;
   const t={id:run+':'+workStepId,backendTaskId:workStepId,runId:run,title:displayTitle,text:displayTitle,instructions:item.instruction,status,deps:[],workStepId};
   const g={id,key:id,runId:run,title:displayTitle,status,dynamicWork:true,workResultKind:end?(noChange?'source_check':'source_edit'):null,workStepId,parentGroupId:parent.id,taskIds:[t.id],tasks:[t],deps:previous?[previous]:[...parent.deps],artifactCount:0,events};additions.push(g);previous=id;
  }
  if(previous)parent.deps=[previous];
 }
 work.push(...additions);return work;
}
