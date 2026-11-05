// Project-local, versioned references. No chat transcript, key, file content,
// server approval or running process is copied into this structure.
const FORMAT='mulo-project-structure',KINDS=['goal','decision','component','task','artifact','evidence','message'],STATUSES=['proposed','observed','user_recorded'];
const RELATIONS=['belongs_to_goal','depends_on','connects_to','documents','evidence_for','related_to'];
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&Object.keys(x).every(k=>keys.includes(k));
const keyPattern=/^[A-Za-z0-9_.:/|+-]{1,500}$/,idPattern=/^[A-Za-z0-9_.:/-]{1,180}$/;
const safeId=(x,label='ID')=>{if(typeof x!=='string'||!idPattern.test(x)||x.startsWith('/')||/\b(?:sk-|ghp_|github_pat_)/i.test(x))throw Error('Invalid '+label+'.');return x;};
const newId=prefix=>prefix+crypto.randomUUID();
function clean(value,max=2000){
 if(value==null)return '';if(typeof value!=='string'||value.length>max)throw Error('Invalid or oversized structure text.');
 return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,'[REDACTED]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/g,'[REDACTED]')
  .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}=*/gi,'$1[REDACTED]')
  .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret|client[_ -]?secret|authorization|cookie)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1=[REDACTED]')
  .replace(/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\b/g,'[REDACTED]')
  .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]+|(?<![:\w/])(?:~\/|\/(?:Users|home|private|var|tmp|mnt|Volumes|opt)\/)[^\s"'<>]+/g,'[PRIVATE PATH]');
}
function boundedText(lines,max=2000){const text=lines.filter(Boolean).join('\n'),suffix='\n[Additional details omitted]';return clean(text.length>max?text.slice(0,max-suffix.length)+suffix:text,max);}
const emptySource=sessionId=>({sessionId,messageId:null,runId:null,eventId:null,sourceRevision:null});
export function emptyProjectStructure(projectId){return {format:FORMAT,version:1,projectId:safeId(projectId,'project ID'),revision:0,heads:[],records:[]};}
function sameKeys(x,keys){return exact(x,keys);}
function validNullableId(x){return x===null||typeof x==='string'&&idPattern.test(x)&&!x.startsWith('/')&&!/\b(?:sk-|ghp_|github_pat_)/i.test(x);}
export function validateProjectStructure(value,projectId){
 if(!sameKeys(value,['format','version','projectId','revision','heads','records'])||value.format!==FORMAT||value.version!==1||value.projectId!==projectId||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.heads)||value.heads.length>100||!Array.isArray(value.records)||value.records.length>500)throw Error('Invalid project structure or project mismatch.');
 if(new TextEncoder().encode(JSON.stringify(value)).length>2_000_000)throw Error('Project structure exceeds 2 MB.');
 const recordIds=new Set(),keys=new Set(),versionIds=new Set();
 for(const r of value.records){
  if(!sameKeys(r,['id','key','kind','sessionId','versions'])||!/^ctx_[0-9a-f-]{36}$/.test(r.id)||recordIds.has(r.id)||typeof r.key!=='string'||!keyPattern.test(r.key)||keys.has(r.key)||!KINDS.includes(r.kind)||!validNullableId(r.sessionId)||r.sessionId===null||!Array.isArray(r.versions)||!r.versions.length||r.versions.length>32)throw Error('Invalid or duplicate structure record.');
  const prefix=r.kind+'|'+r.sessionId+'|';if(!r.key.startsWith(prefix))throw Error('Invalid structure provenance.');safeId(r.key.slice(prefix.length),'local source ID');
  recordIds.add(r.id);keys.add(r.key);
  for(const v of r.versions){
   if(!sameKeys(v,['id','planRunId','label','text','rationale','status','source','links'])||!/^ver_[0-9a-f-]{36}$/.test(v.id)||versionIds.has(v.id)||!validNullableId(v.planRunId)||!STATUSES.includes(v.status)||typeof v.label!=='string'||!v.label.trim()||v.label.length>200||typeof v.text!=='string'||v.text.length>2000||typeof v.rationale!=='string'||v.rationale.length>2000||clean(v.label,200)!==v.label||clean(v.text)!==v.text||clean(v.rationale)!==v.rationale)throw Error('Invalid structure version.');
   versionIds.add(v.id);
   const p=v.source;if(!sameKeys(p,['sessionId','messageId','runId','eventId','sourceRevision'])||p.sessionId!==r.sessionId||!validNullableId(p.messageId)||!validNullableId(p.runId)||!validNullableId(p.eventId)||!(p.sourceRevision===null||typeof p.sourceRevision==='string'&&/^[a-f0-9]{64}$/.test(p.sourceRevision)))throw Error('Invalid source provenance.');
   if(!Array.isArray(v.links)||v.links.length>100)throw Error('Invalid structure links.');
   for(const l of v.links)if(!sameKeys(l,['relation','recordId','versionId','label'])||!RELATIONS.includes(l.relation)||typeof l.recordId!=='string'||typeof l.versionId!=='string'||typeof l.label!=='string'||l.label.length>250||clean(l.label,250)!==l.label)throw Error('Invalid structure link.');
  }
 }
 const pairMap=new Map(value.records.flatMap(r=>r.versions.map(v=>[r.id+'|'+v.id,{record:r,version:v}]))),pairs=new Set(pairMap.keys());
 for(const r of value.records)for(const v of r.versions){
  if(['goal','component','task'].includes(r.kind)&&v.status!=='proposed'||r.kind==='decision'&&!['proposed','user_recorded'].includes(v.status)||r.kind==='message'&&v.status!=='user_recorded'||['artifact','evidence'].includes(r.kind)&&v.status!=='observed')throw Error('Invalid structure record status.');
  if(['component','task','decision'].includes(r.kind)&&v.status==='proposed'&&v.links.filter(l=>l.relation==='belongs_to_goal').length!==1)throw Error('Missing goal lineage.');
  const seen=new Set();for(const l of v.links){const k=JSON.stringify([l.relation,l.recordId,l.versionId,l.label]),target=pairMap.get(l.recordId+'|'+l.versionId);if(!target||seen.has(k)||target.version.id===v.id)throw Error('Missing, duplicate or self structure link.');seen.add(k);
  if(l.relation!=='related_to'&&(target.record.sessionId!==r.sessionId||target.version.planRunId!==v.planRunId))throw Error('Structure link crosses source revisions.');
  if(l.relation==='belongs_to_goal'&&target.record.kind!=='goal'||l.relation==='depends_on'&&(r.kind!=='task'||target.record.kind!=='task')||l.relation==='connects_to'&&(r.kind!=='component'||target.record.kind!=='component')||l.relation==='evidence_for'&&(r.kind!=='evidence'||!['task','goal'].includes(target.record.kind))||l.relation==='documents'&&(r.kind!=='artifact'||!['task','goal'].includes(target.record.kind)))throw Error('Invalid structure relationship.');
  if(['depends_on','connects_to'].includes(l.relation)){const a=v.links.find(x=>x.relation==='belongs_to_goal'),b=target.version.links.find(x=>x.relation==='belongs_to_goal');if(!a||!b||a.recordId!==b.recordId||a.versionId!==b.versionId)throw Error('Structure link crosses goal snapshots.');}
 }}
 const done=new Set(),visiting=new Set();function visit(pair){if(visiting.has(pair))throw Error('Cyclic task dependency.');if(done.has(pair))return;visiting.add(pair);for(const l of pairMap.get(pair).version.links)if(l.relation==='depends_on')visit(l.recordId+'|'+l.versionId);visiting.delete(pair);done.add(pair);}for(const [pair,item] of pairMap)if(item.record.kind==='task')visit(pair);
 const headSessions=new Set();for(const h of value.heads){if(!sameKeys(h,['sessionId','planRunId','goalId','goalVersionId'])||!validNullableId(h.sessionId)||h.sessionId===null||!validNullableId(h.planRunId)||h.planRunId===null||headSessions.has(h.sessionId)||!pairs.has(h.goalId+'|'+h.goalVersionId))throw Error('Invalid project structure head.');headSessions.add(h.sessionId);const g=value.records.find(r=>r.id===h.goalId);if(g.kind!=='goal'||g.sessionId!==h.sessionId||!g.versions.some(v=>v.id===h.goalVersionId&&v.planRunId===h.planRunId))throw Error('Invalid goal head.');}
 return structuredClone(value);
}
const canonical=v=>JSON.stringify(v);
function baseStore(project){return validateProjectStructure(project.structure||emptyProjectStructure(project.id),project.id);}
function originMessage(s,p){
 const proposal=p.revisionOf?.proposalRunId,request=proposal&&(s.runs||[]).find(r=>r.id===proposal)?.requestId;
 if(request&&(s.messages||[]).some(m=>m.id===request))return request;
 const viaProposal=proposal&&(s.messages||[]).find(m=>m.planConversationRunId===proposal&&typeof m.id==='string');
 if(viaProposal)return viaProposal.id;
 const source=p.restoreOf?.sourcePlanRunId||p.runId,root=(s.workflow?.tasks||[]).find(t=>t.id===source+':goal'),id=root?.sourceId;
 return typeof id==='string'&&(s.messages||[]).some(m=>m.id===id)?id:null;
}
function ensureRecord(store,kind,sessionId,localId){
 safeId(sessionId,'session ID');safeId(localId,'local source ID');const key=kind+'|'+sessionId+'|'+localId;
 let r=store.records.find(x=>x.key===key);if(!r){r={id:newId('ctx_'),key,kind,sessionId,versions:[]};store.records.push(r);}return r;
}
function sourceFor(sessionId,runId,messageId=null,eventId=null,sourceRevision=null){return {...emptySource(sessionId),runId:runId||null,messageId:messageId||null,eventId:eventId||null,sourceRevision:sourceRevision||null};}
function addVersion(record,planRunId,body,{fresh=false}={}){
 const existing=!fresh&&record.versions.findLast(v=>{const {id,...old}=v;return canonical(old)===canonical({planRunId,...body});});
 if(existing)return existing;
 const v={id:newId('ver_'),planRunId,...body};record.versions.push(v);return v;
}
const link=(relation,record,version,label='')=>({relation,recordId:record.id,versionId:version.id,label:clean(label,250)});
const semantic=body=>{const {id,planRunId,...fields}=body;return canonical({...fields,links:fields.links.map(({relation,recordId,label})=>({relation,recordId,label}))});};
// Only recorded Plan fields and observable event/bundle metadata are projected.
// No reasoning, chat transcript or artifact content is inferred or copied.
export function captureSessionStructure(project,s){
 if(!project||!s||!s.projectId||s.projectId!==project.id)throw Error('Assign this session to the same project first.');
 const p=s.pendingPlan;if(!p||!/^run_[A-Za-z0-9-]+$/.test(p.runId||'')||!Array.isArray(p.tasks))throw Error('Create or select a recorded plan first.');
 const store=baseStore(project),before=canonical(store),sid=safeId(s.id),pid=p.runId,message=originMessage(s,p),source=sourceFor(sid,pid,message);
 const goal=ensureRecord(store,'goal',sid,'goal'),components=new Map(),tasks=new Map(),decisions=[];
 for(const n of p.architecture?.nodes||[])components.set(n.id,ensureRecord(store,'component',sid,n.id));
 for(const t of p.tasks)tasks.set(t.id,ensureRecord(store,'task',sid,t.id));
 for(const [i,d] of (p.architecture?.designDecisions||[]).entries())decisions.push({record:ensureRecord(store,'decision',sid,pid+':decision:'+i),text:clean(d,1000)});
 const prior=store.heads.find(h=>h.sessionId===sid),priorGoal=prior&&goal.versions.find(v=>v.id===prior.goalVersionId),goalBody={label:clean(p.goalTitle||'Goal',200),text:clean(p.goalSummary||'',2000),rationale:'',status:'proposed',source,links:[]};
 const oldVersion=r=>prior?.planRunId===pid&&r.versions.findLast(v=>v.planRunId===pid&&v.links.some(l=>l.relation==='belongs_to_goal'&&l.recordId===goal.id&&l.versionId===prior.goalVersionId));
 const specs=[];
 for(const n of p.architecture?.nodes||[]){
  const links=[{relation:'belongs_to_goal',recordId:goal.id,label:''}];for(const e of p.architecture.edges||[])if(e.from===n.id&&components.has(e.to))links.push({relation:'connects_to',recordId:components.get(e.to).id,label:boundedText([e.label,e.type,e.protocol],250)});
  const text=boundedText([n.description,n.boundary?'Boundary: '+n.boundary:'',...(n.responsibilities||[]).map(x=>'Responsibility: '+x),...(n.interfaces||[]).map(x=>'Interface: '+x),...(n.dataOwnership||[]).map(x=>'Data ownership: '+x)]);
  specs.push({record:components.get(n.id),body:{label:clean(n.label||n.id,200),text,rationale:clean(n.rationale||'',2000),status:'proposed',source,links}});
 }
 for(const t of p.tasks){const links=[{relation:'belongs_to_goal',recordId:goal.id,label:''}];for(const dep of t.dependencies||[])if(tasks.has(dep))links.push({relation:'depends_on',recordId:tasks.get(dep).id,label:''});specs.push({record:tasks.get(t.id),body:{label:clean(t.title||t.id,200),text:clean(t.instruction||'',2000),rationale:'',status:'proposed',source,links}});}
 for(const d of decisions)specs.push({record:d.record,body:{label:'Design decision',text:d.text,rationale:'',status:'proposed',source,links:[{relation:'belongs_to_goal',recordId:goal.id,label:''}]}});
 const active=store.records.filter(r=>r.sessionId===sid&&['component','task','decision'].includes(r.kind)&&oldVersion(r));
 const changed=!priorGoal||prior.planRunId!==pid||semantic(priorGoal)!==semantic({planRunId:pid,...goalBody})||active.length!==specs.length||specs.some(({record,body})=>{const v=oldVersion(record);return !v||semantic(v)!==semantic({id:v.id,planRunId:pid,...body});});
 const gv=changed?addVersion(goal,pid,goalBody,{fresh:true}):priorGoal;
 const componentVersions=new Map(),taskVersions=new Map();
 for(const n of p.architecture?.nodes||[]){const r=components.get(n.id);componentVersions.set(n.id,changed?newId('ver_'):oldVersion(r).id);}
 for(const t of p.tasks){const r=tasks.get(t.id);taskVersions.set(t.id,changed?newId('ver_'):oldVersion(r).id);}
 const targetVersions=new Map([[goal.id,gv.id],...Array.from(components,([id,r])=>[r.id,componentVersions.get(id)]),...Array.from(tasks,([id,r])=>[r.id,taskVersions.get(id)])]);
 for(const {record,body} of specs){
  const links=body.links.map(l=>({...l,versionId:targetVersions.get(l.recordId)}));
  if(changed){const id=record.kind==='component'?componentVersions.get(record.key.slice(('component|'+sid+'|').length)):record.kind==='task'?taskVersions.get(record.key.slice(('task|'+sid+'|').length)):newId('ver_');record.versions.push({id,planRunId:pid,...body,links});}
 }

 const linked=p.linkedRestore?.sourceRunId,ownedRuns=new Set((s.events||[]).filter(e=>e.type==='project.generating'&&e.planRunId===pid).map(e=>e.runId));
 if(linked)ownedRuns.add(linked);
 for(const a of (s.artifacts||[]).filter(a=>ownedRuns.has(a.runId)&&typeof a.id==='string'&&typeof a.name==='string')){
  const local=typeof a.taskId==='string'&&a.taskId.startsWith(a.runId+':')?a.taskId.slice(a.runId.length+1):null,target=tasks.get(local),version=taskVersions.get(local),r=ensureRecord(store,'artifact',sid,a.id),as=sourceFor(sid,a.runId);
  addVersion(r,pid,{label:clean(a.name,200),text:'Artifact metadata recorded; file contents are excluded. Build and execution need separate evidence.',rationale:'',status:'observed',source:as,links:target&&version?[{relation:'documents',recordId:target.id,versionId:version,label:''}]:[link('documents',goal,gv)]});
 }
 for(const b of (s.projectBundles||[]).filter(b=>ownedRuns.has(b.runId)&&/^[a-f0-9]{64}$/.test(b.revision||''))){
  const r=ensureRecord(store,'artifact',sid,b.runId+':'+b.revision),bs=sourceFor(sid,b.runId,null,null,b.revision);addVersion(r,pid,{label:'Source snapshot',text:'Saved source · execution and tests require separate evidence.',rationale:'',status:'observed',source:bs,links:[link('documents',goal,gv)]});
 }
 const evidenceTypes=new Set(['task.completed','task.failed','validation.completed','project.generated','run.failed']);
 const evidence=(s.events||[]).filter(e=>ownedRuns.has(e.runId)&&evidenceTypes.has(e.type));
 if(evidence.length>100)throw Error('Too many evidence events to capture safely; select a smaller scope.');
 for(const e of evidence){
  if(!e.id)continue;const local=e.lineage?.nodeId||String(e.taskId||'').split(':').at(-1),target=tasks.get(local),version=taskVersions.get(local),r=ensureRecord(store,'evidence',sid,e.id),es=sourceFor(sid,e.runId,null,e.id,null);
  addVersion(r,pid,{label:clean(e.type,200),text:e.type==='task.completed'?'Draft recorded; execution not established.':e.type==='validation.completed'?'Recorded schema/path checks; execution not established.':e.type==='project.generated'?'Source saved; build and tests are separate.':'Recorded operation failure.',rationale:'',status:'observed',source:es,links:target&&version?[{relation:'evidence_for',recordId:target.id,versionId:version,label:''}]:[link('evidence_for',goal,gv)]});
 }
 const head={sessionId:sid,planRunId:pid,goalId:goal.id,goalVersionId:gv.id};if(prior)Object.assign(prior,head);else store.heads.push(head);
 if(canonical(store)!==before)store.revision++;
 return validateProjectStructure(store,project.id);
}
export function linkMessageToStructure(project,s,index,{kind='decision',label,rationale='',targetId=null,targetVersionId=null}={}){
 if(!project||s.projectId!==project.id)throw Error('Assign this session to the same project first.');
 if(!['decision','message'].includes(kind))throw Error('Choose a supported conversation record.');
 const message=s.messages?.[index];if(!message||!['user','assistant'].includes(message.role)||message.kind==='welcome')throw Error('Select a conversation message.');
 const messageId=message.id||newId('msg_'),store=baseStore(project),before=canonical(store),r=ensureRecord(store,kind,s.id,messageId),target=targetId&&store.records.find(x=>x.id===targetId),targetVersion=target&&target.versions.find(v=>v.id===targetVersionId);
 if((targetId||targetVersionId)&&!targetVersion)throw Error('The selected structure reference is no longer available.');
 const body={label:clean(label,200),text:'',rationale:clean(rationale,2000),status:'user_recorded',source:sourceFor(s.id,null,messageId),links:target?[link('related_to',target,targetVersion)]:[]};
 if(!body.label.trim())throw Error('Enter a short label.');
 const v=addVersion(r,null,body);if(canonical(store)!==before)store.revision++;const result=validateProjectStructure(store,project.id);
 return {structure:result,messageId,versionId:v.id};
}
export function selectProjectSources(project,s,selection,availableSessionIds=null){
 selection=Array.isArray(selection)?selection:[];
 if(!project||s.projectId!==project.id)return {sources:[],stale:selection.length};
 const store=baseStore(project),sources=[],seen=new Set();let stale=0;
 for(const x of selection||[]){
  const r=store.records.find(y=>y.id===x?.recordId),v=r?.versions.find(y=>y.id===x?.versionId),head=r&&store.heads.find(h=>h.sessionId===r.sessionId);
  if(!r||!v||seen.has(r.id)||!versionMatchesHead(store,r,v,head,new Set(),availableSessionIds)){stale++;continue;}
  seen.add(r.id);const text=['Project structure · '+r.kind+' · '+v.status,v.label,v.text,v.rationale?'Rationale: '+v.rationale:''].filter(Boolean).join('\n');
  sources.push({id:'project-context:'+r.id+':'+v.id,name:v.label,text,projectId:project.id,recordId:r.id,versionId:v.id});
 }
 return {sources,stale};
}
export function versionMatchesHead(store,record,version,head=store.heads.find(h=>h.sessionId===record.sessionId),seen=new Set(),availableSessionIds=null){
 if(availableSessionIds&&!availableSessionIds.has(record.sessionId))return false;
 const key=record.id+'|'+version.id;if(seen.has(key))return false;seen.add(key);
 if(version.status==='user_recorded')return record.versions.at(-1)?.id===version.id&&version.links.filter(l=>l.relation==='related_to').every(l=>{const target=store.records.find(r=>r.id===l.recordId),v=target?.versions.find(x=>x.id===l.versionId),h=target&&store.heads.find(x=>x.sessionId===target.sessionId);return target&&v&&versionMatchesHead(store,target,v,h,new Set(seen),availableSessionIds);});
 if(!head||version.planRunId!==head.planRunId)return false;
 if(record.kind==='goal')return record.id===head.goalId&&version.id===head.goalVersionId;
 for(const l of version.links){if(!['belongs_to_goal','documents','evidence_for'].includes(l.relation))continue;const target=store.records.find(r=>r.id===l.recordId),targetVersion=target?.versions.find(v=>v.id===l.versionId);if(target&&targetVersion&&versionMatchesHead(store,target,targetVersion,head,new Set(seen),availableSessionIds))return true;}
 return false;
}
export function projectSessionIds(state,projectId){
 return new Set((state.sessions||[]).filter(s=>s.projectId===projectId&&!s.deleted).map(s=>s.id));
}
export function projectStructureBusy(state,projectId,activeSessionIds=new Set()){
 if(!projectId)return false;
 return (state.sessions||[]).some(s=>s.projectId===projectId&&(activeSessionIds.has(s.id)||['running','starting','unconfirmed'].includes(s.liveRun?.status)||!!s.goalTransitionSubmission||!!s.goalTransitionClaim||!!s.goalTransitionCancel||!!(s.goalTransition&&s.goalTransition.state!=='closed')));
}
// Rebuild, rather than trust saved excerpts: moving a source chat out of the
// project or advancing its plan cannot silently leak an older selection.
export function syncProjectContextInputs(state,s){
 const selected=Array.isArray(s.projectContextSelection)?s.projectContextSelection:[];
 const p=state.projects?.find(x=>x.id===s.projectId);
 try{
  const result=selected.length>10?{sources:[],stale:selected.length}:selectProjectSources(p,s,selected,projectSessionIds(state,s.projectId));
  s.projectContextInputs=result.sources;s.projectContextStale=result.stale;return result;
 }catch{s.projectContextInputs=[];s.projectContextStale=selected.length;s.projectStructureWarning='Project structure is invalid or unavailable. No project excerpts were selected.';return {sources:[],stale:selected.length};}
}
// Capture only accepted, terminal events. An invalid structure is kept unchanged
// and cannot interfere with the underlying run or impersonate a successful one.
export function applyAndCaptureProjectEvent(state,s,event,apply){
 const applied=apply(s,event);
 if(!applied||!['run.completed','run.failed','run.cancelled'].includes(event.type)||!s.projectId||!s.pendingPlan||s.liveRun?.discardConversation)return applied;
 captureSettledProjectStructure(state,s);
 return applied;
}
export function captureSettledProjectStructure(state,s){
 if(!['completed','failed','cancelled'].includes(s.liveRun?.status)||!s.projectId||!s.pendingPlan||s.liveRun?.discardConversation)return false;
 const p=state.projects?.find(x=>x.id===s.projectId);
 if(!p)return false;
 try{p.structure=captureSessionStructure(p,s);delete s.projectStructureWarning;return true;}
 catch{s.projectStructureWarning='Project structure could not be updated. Existing records were preserved; inspect the current plan.';return false;}
}
export function mergeProjectStructure(project,incoming){
 const next=validateProjectStructure(incoming,project.id),current=baseStore(project);
 if(!current.records.length&&!current.heads.length)return next;
 if(canonical(current)===canonical(next))return current;
 throw Error('Project structure differs. Nothing was overwritten; review the conflict.');
}
export function exportProjectStructure(project,availableSessionIds){
 const value=baseStore(project);
 if(!(availableSessionIds instanceof Set)||value.records.some(r=>!availableSessionIds.has(r.sessionId)))throw Error('Restore or move the source chats back into this project before exporting.');
 return value;
}
