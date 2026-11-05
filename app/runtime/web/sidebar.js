/** Workspace navigation only. Rendering never changes selection or starts work. */
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sidebarSections(state){
 const projects=state.projects.filter(p=>!p.archived).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)),activeIds=new Set(projects.map(p=>p.id)),allIds=new Set(state.projects.map(p=>p.id));
 const sessions=state.sessions.filter(s=>!s.deleted&&!s.archived&&(activeIds.has(s.projectId)||!allIds.has(s.projectId)));
 const recent=[...sessions].sort((a,b)=>(conversationActivityAt(b)||validTime(b.createdAt))-(conversationActivityAt(a)||validTime(a.createdAt)));
 return {pinned:recent.filter(s=>s.pinned&&!activeIds.has(s.projectId)),projects:projects.map(p=>({...p,sessions:sessions.filter(s=>s.projectId===p.id).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned))})),recent:recent.filter(s=>!s.pinned).slice(0,20)};
}
export function toggleSidebarSection(state,key){if(!['pinned','projects','recent'].includes(key))return false;state.sidebarCollapsed={...state.sidebarCollapsed,[key]:!state.sidebarCollapsed?.[key]};return true;}
export function toggleSidebarProject(state,id){if(!state.projects.some(p=>p.id===id&&!p.archived))return false;state.sidebarProjectCollapsed={...state.sidebarProjectCollapsed,[id]:!(state.sidebarProjectCollapsed?.[id]??(id!==state.projectId))};return true;}
// Opening, renaming, importing and background events are not conversation activity.
// Legacy chats without dated messages keep their stable saved order, not click history.
const validTime=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;
export function conversationActivityAt(session){
 if(Object.hasOwn(session,'lastConversationAt'))return validTime(session.lastConversationAt);
 const messages=(session.messages||[]).filter(m=>m.role==='user');
 const ids=new Set(messages.map(m=>m.id).filter(Boolean));
 return Math.max(0,...messages.map(m=>validTime(m.createdAt)),...(session.workflow?.requests||[]).filter(r=>ids.has(r.id)).map(r=>validTime(r.createdAt)));
}
export function recordConversationActivity(session,message,now=Date.now()){
 if(message?.role!=='user'||typeof message.text!=='string'||!message.text.trim()||!validTime(now))return false;
 const time=Math.max(validTime(now),conversationActivityAt(session)+1);
 message.createdAt=time;session.lastConversationAt=time;return true;
}
// A saved running flag is historical evidence, not proof of a live browser stream.
export function sidebarRunState(session,{ownedRun=false}={}){
 const run=session?.liveRun;
 if(session?.archived||session?.deleted||run?.status!=='running')return 'idle';
 if(ownedRun===true&&!run.recovered)return run.interactionMode==='agent'&&run.controlPhase==='paused'?'paused':'running';
 return 'unconfirmed';
}
export function sidebarRunIndicator(session,options={}){
 const status=sidebarRunState(session,options);
 if(status==='idle')return '';
 const label=status==='running'?'Work in progress':status==='paused'?'Work paused':'Run status unconfirmed · refresh saved status';
 return `<span class="sidebar-run-indicator" data-run-state="${status}" role="img" aria-label="${label}" title="${label}"></span>`;
}
export function sidebarProjectRunIndicator(sessions,{isRunOwned=()=>false}={}){
 const statuses=sessions.map(s=>sidebarRunState(s,{ownedRun:isRunOwned(s)===true}));
 if(!statuses.some(s=>s!=='idle'))return '';
 const active=statuses.filter(s=>s==='running').length,paused=statuses.filter(s=>s==='paused').length,status=active?'running':statuses.includes('unconfirmed')?'unconfirmed':'paused';
 const label=active?`${active} session${active===1?'':'s'} with work in progress`:status==='paused'?`${paused} session${paused===1?'':'s'} paused`:'Session run status unconfirmed · refresh saved status';
 return `<span class="sidebar-run-indicator" data-run-state="${status}" role="img" aria-label="${label}" title="${label}"></span>`;
}
export function renderSidebarNavigation(state,sessionRows,options={}){
 const groups=sidebarSections(state),e=escapeHTML;
 const section=(key,label,content,extra='')=>{const open=!state.sidebarCollapsed?.[key];return `<section class="workspace-section"><div class="workspace-section-heading"><button class="workspace-section-toggle" data-sidebar-section="${key}" aria-expanded="${open}" aria-controls="sidebar-${key}"><span class="workspace-chevron" aria-hidden="true">${open?'⌄':'›'}</span>${label}</button>${extra}</div><div id="sidebar-${key}" ${open?'':'hidden'}>${content}</div></section>`;};
 const folder='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3z"/></svg>';
 const pin='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3h8l-1 6 4 4v2h-6v6l-2-2v-4H5v-2l4-4z"/></svg>';
 const projects=groups.projects.map(p=>{const open=!(state.sidebarProjectCollapsed?.[p.id]??(p.id!==state.projectId));return `<div class="workspace-project"><div class="workspace-project-row ${p.id===state.projectId?'selected':''}" data-context-project="${e(p.id)}" tabindex="0" aria-label="Project ${e(p.title)}"><button class="workspace-project-toggle" data-sidebar-project="${e(p.id)}" aria-expanded="${open}" aria-label="${open?'Collapse':'Expand'} ${e(p.title)}">${open?'⌄':'›'}</button><button class="workspace-project-name" data-open-project="${e(p.id)}">${folder}<span>${e(p.title)}</span>${sidebarProjectRunIndicator(p.sessions,options)}</button><button class="session-more" data-menu-project="${e(p.id)}" aria-label="Project options for ${e(p.title)}" aria-haspopup="menu">···</button><button class="pin-button ${p.pinned?'pinned':''}" data-pin-project="${e(p.id)}" aria-label="${p.pinned?'Unpin':'Pin'} project ${e(p.title)}" aria-pressed="${!!p.pinned}">${pin}</button></div><div class="workspace-project-sessions" ${open?'':'hidden'}><button class="project-new-chat" data-new-project-chat="${e(p.id)}" aria-label="New chat in ${e(p.title)}">+ New chat</button>${p.sessions.length?sessionRows(p.sessions):'<p class="workspace-empty">No sessions yet</p>'}</div></div>`;}).join('');
 return section('pinned','Pinned',groups.pinned.length?sessionRows(groups.pinned):'<p class="workspace-empty">Pin a session from its menu</p>')+section('projects','Projects',projects,'<button class="workspace-add-project" data-action="new-project" aria-label="New project"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg></button>')+section('recent','Recents',groups.recent.length?sessionRows(groups.recent):'<p class="workspace-empty">Your recent sessions appear here</p>');
}
