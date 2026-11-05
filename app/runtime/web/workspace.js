export function ensureWorkspace(state){
 if(!Array.isArray(state.projects))state.projects=[];
 const ids=new Set(state.projects.map(p=>p.id));for(const p of state.projects){p.archived=!!p.archived;p.pinned=!!p.pinned;}
 for(const s of state.sessions){s.deleted=s.deleted===true;if(!s.deleted&&!ids.has(s.projectId)){s.projectId=null;s.projectAssignment={source:'unassigned'};}s.pinned=!!s.pinned;s.archived=!!s.archived;s.deleted=s.deleted===true;s.deletedAt=s.deleted&&Number.isFinite(s.deletedAt)&&s.deletedAt>0?s.deletedAt:null;}
 if(!ids.has(state.projectId))state.projectId=state.sessions.find(s=>s.id===state.current)?.projectId||null;
 // No title/id heuristic: legacy Personal may contain intentionally assigned work.
 return state;
}
function validName(value,max){const n=String(value||'').trim();if(!n||n.length>max)throw Error('Use a name between 1 and '+max+' characters.');return n;}
export function createProject(state,title){const p={id:'project_'+crypto.randomUUID(),title:validName(title,64),createdAt:Date.now(),archived:false,pinned:false,origin:'user_created'};state.projects.push(p);state.projectId=p.id;return p;}
export function renameProject(state,id,title){const p=state.projects.find(p=>p.id===id);if(!p)throw Error('Project not found.');p.title=validName(title,64);return p;}
export function renameSession(state,id,title){const s=state.sessions.find(s=>s.id===id);if(!s)throw Error('Session not found.');if(s.deleted)throw Error('Restore this chat from Trash before renaming it.');s.title=validName(title,100);return s;}
export function moveSession(state,id,projectId){projectId=projectId||null;const s=state.sessions.find(s=>s.id===id),p=state.projects.find(p=>p.id===projectId&&!p.archived);if(!s||(projectId&&!p))throw Error('Choose an active destination project.');if(s.deleted)throw Error('Restore this chat from Trash before moving it.');if(s.liveRun?.status==='running')throw Error('Stop the active run before moving this session.');s.projectId=projectId;s.projectAssignment={source:projectId?'explicit_move':'explicit_unassigned',projectId};return s;}
export function archiveSession(state,id,archived=true){const s=state.sessions.find(s=>s.id===id);if(!s)throw Error('Session not found.');if(s.deleted)throw Error('Restore this chat from Trash before archiving it.');if(archived&&sessionTrashBlocked(s))throw Error('Stop active work and confirm its final status before archiving.');s.archived=!!archived;return s;}
export function archiveProject(state,id,archived=true){const p=state.projects.find(p=>p.id===id);if(!p)throw Error('Project not found.');if(archived&&state.sessions.some(s=>s.projectId===id&&sessionTrashBlocked(s)))throw Error('Stop this project’s active run before archiving.');p.archived=!!archived;return p;}
export function projectSessions(state,{includeArchived=false}={}){return state.sessions.filter(s=>!s.deleted&&s.projectId===state.projectId&&(includeArchived||!s.archived));}

// Soft deletion is local navigation state only; history, source files and server ledger are untouched.
export function sessionTrashBlocked(session){
 const active=new Set(['running','starting','pending','interrupted','unknown','uncertain']);
 const events=Array.isArray(session.events)?session.events:[],started=new Set(),terminal=new Set();
 for(const event of events){if(!event?.runId)continue;if(event.type==='run.started')started.add(event.runId);if(['run.completed','run.failed','run.cancelled'].includes(event.type))terminal.add(event.runId);}
 for(const run of [session.liveRun,session.execution,session.executionRun])if(run&&(active.has(run.status)||run.active===true||(Number(run.reservedUsd)>0&&!terminal.has(run.runId))))return true;
 if([...started].some(id=>!terminal.has(id)))return true;
 for(const check of Array.isArray(session.executionChecks)?session.executionChecks:[])if(check&&(active.has(check.status)||check.status==='unverified'||check.active===true))return true;
 const live=session.liveRun;
 if(live?.runId&&!terminal.has(live.runId))return true;
 return false;
}
export function trashSession(state,id,deleted=true){
 const session=state.sessions.find(s=>s.id===id);if(!session)throw Error('Session not found.');
 const target=!!deleted;
 if(target&&sessionTrashBlocked(session))throw Error('Stop the run and confirm its saved terminal status before moving this chat to Trash.');
 if(target){if(session.deleted!==true){session.deleted=true;session.deletedAt=Date.now();}}
 else {session.deleted=false;session.deletedAt=null;}
 return session;
}
