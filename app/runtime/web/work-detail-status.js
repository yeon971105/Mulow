// Public operational metadata only. Never infer hidden reasoning, percentages or future completion.
const TERMINAL={ 'run.completed':'completed','run.failed':'failed','run.cancelled':'stopped' };
const toolStage=name=>name==='source.verify'?['compiling','Compiling source']:name==='model.chat.completions'?['waiting_response','Waiting for model response']:name==='artifact.save'?['saving','Saving files']:['artifact.validate','plan.validate'].includes(name)?['validating','Validating recorded output']:['operation','Recorded operation in progress'];
const time=e=>{const value=Date.parse(e?.at||e?.time||'');return Number.isFinite(value)?value:null;};
const safeText=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,160):'';
export function deriveWorkDetailStatus({events=[],runId,taskIds=null,runStatus=null,historical=false,stale=false,connected=true,now=Date.now(),tasks=[]}={}){
 const result={state:'idle',stage:'not_started',label:'No operation is recorded for this work.',elapsedMs:null,elapsedSince:null,taskTitle:null,operationLabel:null,operationId:null,activeCount:0,next:[],lastObservedAt:null,notice:''};
 if(typeof runId!=='string'||!runId)return result;
 const scoped=id=>typeof id==='string'?(id.startsWith(runId+':')?id:runId+':'+id):null;
 const ids=Array.isArray(taskIds)?new Set(taskIds.map(scoped)):null;
 const runEvents=events.filter(e=>e&&e.runId===runId).map((e,index)=>({...e,_order:index}));
 const selected=runEvents.filter(e=>!ids||ids.has(scoped(e.taskId||e.parentTaskId)));
 const latest=selected.at(-1);result.lastObservedAt=time(latest);
 const runEnd=runEvents.findLast(e=>TERMINAL[e.type]);
 const endsFor=id=>{const ev=selected.filter(e=>scoped(e.taskId||e.parentTaskId)===id);const end=ev.findLast(e=>['task.completed','task.failed','task.cancelled'].includes(e.type));return end&&!ev.some(e=>e._order>end._order&&['task.started','tool.started'].includes(e.type))?end:null;};
 const ownEnds=ids&&ids.size?[...ids].map(endsFor):[];
 let recordedState=ownEnds.length&&ownEnds.every(e=>e?.type==='task.completed')?'completed':ownEnds.some(e=>e?.type==='task.failed')?'failed':ownEnds.some(e=>e?.type==='task.cancelled')?'stopped':runEnd?TERMINAL[runEnd.type]:['failed','cancelled','interrupted','completed'].includes(runStatus)?({cancelled:'stopped'}[runStatus]||runStatus):null;
 if(ids?.size&&recordedState==='completed'&&!ownEnds.every(e=>e?.type==='task.completed'))recordedState='interrupted';
 if(historical){return {...result,state:'historical',stage:'historical',label:'Read-only historical work.',notice:recordedState?'Recorded outcome: '+recordedState+'.':'No live execution is asserted.'};}
 if(stale)return {...result,state:'stale',stage:'unconfirmed',label:'This work belongs to an outdated plan or source.',notice:'Recorded events are preserved; no current progress is asserted.'};
 const planningOnly=runEnd?.type==='run.completed'&&['plan_ready_for_approval','plan_needs_clarification','plan_needs_design'].includes(runEnd.meaning||runEnd.summary);
 if(ids?.size&&planningOnly&&!selected.some(e=>['task.started','task.completed','task.failed','task.cancelled','tool.started','tool.completed','tool.failed','artifacts.created'].includes(e.type)))return {...result,label:'Planned · not started.'};
 if(recordedState){return {...result,state:recordedState,stage:recordedState,label:({completed:'Recorded work ended; execution/test success is not implied.',failed:'Recorded work failed.',stopped:'Recorded work stopped.',interrupted:'Completion is unconfirmed.'})[recordedState],notice:recordedState==='completed'&&runEnd&&TERMINAL[runEnd.type]!=='completed'?'This task completed before the containing run stopped.':''};}
 if(!connected)return {...result,state:'disconnected',stage:'unconfirmed',label:'Connection unavailable; current work state is unconfirmed.',notice:'Showing the last recorded events only.'};
 if(runStatus!=='running')return {...result,state:'unconfirmed',stage:'unconfirmed',label:'Current work state is unconfirmed.',notice:'No live progress is asserted without a recorded active run.'};
 const starts=selected.filter(e=>e.type==='tool.started'&&typeof e.invocationId==='string'&&e.invocationId);
 const active=starts.filter(start=>!selected.some(end=>end._order>start._order&&end.invocationId===start.invocationId&&scoped(end.taskId)===scoped(start.taskId)&&['tool.completed','tool.failed'].includes(end.type)));
 result.activeCount=active.length;
 if(active.length){result.state='running';if(active.length>1){result.stage='parallel_operations';result.label=active.length+' recorded operations are in progress.';}else{const start=active[0],response=selected.findLast(e=>e._order>start._order&&e.type==='model.response'&&e.invocationId===start.invocationId);const [stage,label]=response?['response_received','Model response received; completion is not yet recorded.']:toolStage(start.name);result.stage=stage;result.label=label;result.operationId=start.invocationId;result.operationLabel=label;const task=tasks.find(t=>scoped(t.id)===scoped(start.taskId)&&(!t.runId||t.runId===runId));result.taskTitle=task?safeText(task.title||task.text||task.id):null;const began=time(start);if(began!==null&&Number.isFinite(now)&&now>=began){result.elapsedMs=now-began;result.elapsedSince=new Date(began).toISOString();}}}
 else{const phase=selected.findLast(e=>['work.progress','model.response','task.started','tool.completed','tool.failed','run.started'].includes(e.type));if(phase){result.state=phase.type==='tool.failed'?'failed':'observed';result.stage=phase.type==='tool.failed'?'failed':phase.type==='work.progress'?(['candidate_validation_started','candidate_validation_passed','snapshot_save_started','snapshot_save_completed'].includes(phase.phase)?phase.phase:'operational_update'):phase.type;result.label=phase.type==='tool.failed'?'A recorded operation failed.':phase.type==='model.response'?'Model response recorded.':phase.type==='task.started'?'Task start recorded.':phase.type==='run.started'?'Run start recorded.':phase.type==='tool.completed'?'Recorded operation completed; awaiting further evidence.':({candidate_validation_started:'Checking source format.',candidate_validation_passed:'Source format checked.',snapshot_save_started:'Preparing to save source.',snapshot_save_completed:'Source saved; final completion not yet recorded.'})[phase.phase]||'Operational update recorded.';}}
 // Only an explicit ready/queue record is a next-work candidate; plan order is not scheduling evidence.
 if(runStatus==='running'){
  const queued=runEvents.filter(e=>['task.queued','steering.ready'].includes(e.type));
  for(const event of queued){const id=scoped(event.targetTaskId||event.taskId),task=tasks.find(t=>scoped(t.id)===id&&(!t.runId||t.runId===runId));if(!task||result.next.some(t=>t.id===id)||runEvents.some(e=>e._order>event._order&&scoped(e.taskId)===id&&['task.started','task.completed','task.failed','task.cancelled'].includes(e.type)))continue;const deps=task.dependencies||task.deps;if(!Array.isArray(deps)||!deps.every(dep=>{const d=runEvents.filter(e=>scoped(e.taskId)===scoped(dep));return d.at(-1)?.type==='task.completed';}))continue;result.next.push({id,title:safeText(task.title||task.text||task.id),basis:event.type});if(result.next.length===8)break;
  }
 }
 return result;
}
