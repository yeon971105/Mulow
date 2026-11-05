// Bind evidence to exact session, run and task identity, never the selected canvas as a whole.
const scoped=(run,id)=>typeof id==='string'?(id.startsWith(run+':')?id:run+':'+id):null;
export function nodeEvidence(session,group){
 if(group?.dynamicWork){const events=(session.events||[]).filter(e=>e.sessionId===session.id&&e.runId===group.runId&&e.workStepId===group.workStepId),start=events.find(e=>e.type==='work.step.started'),end=events.find(e=>e.type==='work.step.completed'),at=e=>Date.parse(e?.at||e?.time||'');return {events,artifacts:[],changes:end?.changes||[],changeKnown:!!end,durationMs:end&&start?at(end)-at(start):null,startedAt:!end&&start?new Date(at(start)).toISOString():null,result:end||events.at(-1)};}
 const tasks=group?.tasks||[],pairs=new Set(tasks.flatMap(t=>{const run=t.runId||group.runId;return run?[scoped(run,t.id),scoped(run,t.backendTaskId)].filter(Boolean):[];}));
 const runs=new Set(tasks.map(t=>t.runId||group.runId).filter(Boolean)),whole=!!group?.projectGeneration||!!group?.projectRepair;
 const owned=e=>!e.sessionId||e.sessionId===session.id;
 const events=(session.events||[]).filter(e=>owned(e)&&runs.has(e.runId)&&(whole?(!e.taskId&&!e.agentId?.includes(':worker:')):pairs.has(scoped(e.runId,e.taskId||e.parentTaskId))));
 const artifacts=(session.artifacts||[]).filter(a=>owned(a)&&runs.has(a.runId)&&pairs.has(scoped(a.runId,a.taskId)));
 const receipts=events.filter(e=>e.type==='validation.completed'&&e.sourceVerification?.status==='compiled');
 const changes=new Map();let changeKnown=receipts.length>0;
 for(const e of receipts){
  const current=e.sourceVerification.inputs||[],parent=e.packageBinding?.parentCandidateRevision||e.sourceVerification.baseRevision;
  const prior=parent?(session.events||[]).slice(0,(session.events||[]).indexOf(e)).findLast(p=>owned(p)&&p.type==='validation.completed'&&p.sourceVerification?.sourceRevision===parent)?.sourceVerification?.inputs:null;
  if(parent&&!prior){changeKnown=false;continue;}
  const before=new Map((prior||[]).map(f=>[f.path,f.sha256]));
  for(const f of current)if(before.get(f.path)!==f.sha256)changes.set(f.path,{...f,change:before.has(f.path)?'changed':'created'});
 }
 const starts=events.filter(e=>whole?['project.generating','run.started'].includes(e.type):e.type==='task.started'),ends=events.filter(e=>whole?['project.generated','run.completed','run.failed','run.cancelled'].includes(e.type):['task.completed','task.failed','task.cancelled'].includes(e.type));
 const start=starts[0],end=ends.at(-1),at=e=>Date.parse(e?.at||e?.time||'');
 const durationMs=Number.isFinite(at(start))&&Number.isFinite(at(end))&&at(end)>=at(start)?at(end)-at(start):null;
 const result=ends.at(-1)||receipts.at(-1)||events.findLast(e=>e.type==='tool.completed');
 return {events,artifacts,changes:[...changes.values()],changeKnown,durationMs,startedAt:!end&&Number.isFinite(at(start))?new Date(at(start)).toISOString():null,result};
}
export function nodeDuration(evidence,esc){return evidence.durationMs!==null?'<span class="node-duration" aria-label="Recorded duration">'+esc((evidence.durationMs/1000).toFixed(2))+' s</span>':evidence.startedAt?'<span class="node-duration" data-elapsed-since="'+esc(evidence.startedAt)+'">In progress</span>':'<span class="node-duration">Duration unavailable</span>';}
