// Local event coalescing only. No network or model calls occur in this module.
export function planningSources(s){const refs=(s.references||[]).filter(r=>typeof r.text==='string'&&r.text.trim()).map(r=>({id:r.id,name:r.name,text:r.text}));const shared=(s.projectContextInputs||[]).filter(r=>s.projectId&&r.projectId===s.projectId&&typeof r.text==='string'&&r.text.trim()).map(r=>({id:r.id,name:r.name,text:r.text}));refs.push(...shared);const architecture=s.architecture&&!s.architecture.proposed?s.architecture:s.planningInputArchitecture;if(architecture)refs.push({id:'architecture-blueprint',name:'Architecture blueprint',text:JSON.stringify(architecture)});return refs;}
export function ensurePlanningIntake(s){if(s.architecture&&!s.architecture.proposed)s.planningInputArchitecture=structuredClone(s.architecture);const sources=planningSources(s);const fingerprint=JSON.stringify({sources,chatAttachmentRevision:s.chatAttachmentRevision||0});s.planningIntake||={revision:0,fingerprint:null};const i=s.planningIntake;if(i.fingerprint!==fingerprint){const existed=i.fingerprint!==null;i.fingerprint=fingerprint;i.revision++;i.state=sources.length?'ready':'empty';if(existed&&s.pendingPlan){s.pendingPlan.approved=false;s.pendingPlan.stale=true;}}return i;}
export function inputRevision(s){return s.id+':inputs:'+ensurePlanningIntake(s).revision;}
export function planBlocked(s){const p=s.pendingPlan;return !p||p.stale||p.sourceRevision&&p.sourceRevision!==inputRevision(s)||(p.clarificationQuestions||[]).length>0;}
const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
export function compactPlanningBlueprint(architecture){
 return {nodes:(architecture.nodes||[]).map(n=>pick(n,['id','label','type','kind','parentId','groupId'])),edges:(architecture.edges||[]).map(e=>pick(e,['id','from','to','type','protocol','label'])),...(architecture.groups?{groups:architecture.groups}:{}),omitted:'Optional descriptions, responsibilities, interfaces and other non-topology metadata omitted. All retained node IDs and connections are included.'};
}
export function buildPlanningContext(s,ids,consent){
 if(consent!==true)throw Error('Review and approve the selected excerpts first.');
 const candidates=planningSources(s).filter(r=>ids.includes(r.id));
 if(!candidates.length)throw Error('Select at least one readable source.');
 if(candidates.length>10)throw Error('Select up to ten sources.');
 const context={consent:true,sourceRevision:inputRevision(s),sources:candidates.map(r=>({id:r.id.slice(0,120),name:r.name.slice(0,160),text:r.text,truncated:false}))};
 const limit=s.pendingPlan?2200:4500;
 if(bytes(context)>limit){for(const source of context.sources)if(source.id==='architecture-blueprint'){source.text=JSON.stringify(compactPlanningBlueprint(JSON.parse(source.text)));source.truncated=true;}}
 while(bytes(context)>limit){
  const editable=context.sources.filter(r=>r.id!=='architecture-blueprint'&&r.text.length>=16);
  if(!editable.length)throw Error('The complete architecture topology does not fit the context limit. Select a smaller design or fewer sources.');
  const longest=editable.reduce((a,b)=>a.text.length>b.text.length?a:b);
  longest.text=longest.text.slice(0,Math.max(1,Math.floor(longest.text.length*.8)));longest.truncated=true;
 }
 return context;
}
