// Concise public activity only. Lifecycle events establish activity and outcomes.
export function conciseWorkActivity(live,{status,compiled=false,sourceSaved=false,fileCount=0,failure='',fallback='',resultSummary='',currentAction=''}={}){
 const neutral={running:false,text:'Not started',note:''};
 if(['blocked','waiting','planned','ready'].includes(status))return {...neutral,text:status==='blocked'?'Waiting for a prerequisite':status==='waiting'?'Waiting for dependencies':status==='ready'?'Ready to start':'Not started'};
 if(sourceSaved)return {...neutral,text:'Saved '+fileCount+' source file'+(fileCount===1?'':'s'),note:'Browser tests unverified'};
 if(compiled)return {...neutral,text:resultSummary||'Source compiled',note:resultSummary?'':'Browser tests unverified'};
 if(live.state==='running')return {running:true,text:currentAction||({waiting_response:'Waiting for Muse',response_received:'Checking the model response',compiling:'Compiling source',saving:'Saving files',validating:'Checking output',parallel_operations:live.activeCount+' operations running'})[live.stage]||'Working on the requested change',note:live.taskTitle||''};
 if(live.state==='observed'&&live.stage==='run.started')return {running:true,text:'Starting work',note:''};
 if(['disconnected','unconfirmed','stale','historical'].includes(live.state))return {...neutral,text:({disconnected:'Connection unavailable · status unconfirmed',unconfirmed:'Status unconfirmed',stale:'Earlier work · current version changed',historical:'Earlier work'})[live.state]};
 if(status==='failed'||live.state==='failed')return {...neutral,text:failure||'Work failed'};
 if(['cancelled','stopped','interrupted'].includes(status)||['stopped','interrupted'].includes(live.state))return {...neutral,text:live.state==='interrupted'?'Completion unconfirmed':'Work stopped'};
 if(status==='completed'||live.state==='completed')return {...neutral,text:fileCount?'Saved '+fileCount+' file'+(fileCount===1?'':'s'):'Work finished',note:'Execution and tests unverified'};
 return {...neutral,text:fallback||'Waiting for the next operation'};
}
export function renderConciseWorkActivity(activity,filesHTML,esc){
 return '<section class="work-activity" aria-label="Current work" aria-busy="'+activity.running+'"><div class="work-activity-line" role="status">'+(activity.running?'<span class="work-phase-spinner" aria-label="Working"></span>':'')+'<span>'+esc(activity.text)+'</span></div>'+(activity.note?'<small>'+esc(activity.note)+'</small>':'')+(filesHTML||'')+'</section>';
}
export function renderAvailableWorkFiles({artifacts=[],bundle=null,paths=null,sessionId,esc}){
 const seen=new Set(),links=[];
 for(const a of artifacts){if(!a?.id||a.contentAvailable===false||typeof a.content!=='string'||seen.has(a.name))continue;seen.add(a.name);links.push('<button type="button" data-open-artifact="'+esc(a.id)+'">'+esc(a.name)+'</button>');}
 if(bundle)for(const path of bundle.files||[]){if(typeof path!=='string'||paths&&!paths.includes(path)||seen.has(path))continue;seen.add(path);links.push('<button type="button" data-work-file="'+esc(path)+'" data-work-file-session="'+esc(sessionId)+'" data-work-file-run="'+esc(bundle.runId)+'" data-work-file-revision="'+esc(bundle.revision)+'" title="Open current saved project source">'+esc(path)+'</button>');}
 return links.length?'<div class="work-result-files" aria-label="Available files">'+links.join('')+'</div>':'';
}
