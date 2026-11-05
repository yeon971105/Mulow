import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&Object.keys(x).every(k=>keys.includes(k));
const text=(x,n)=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const fail=(code,details)=>{throw Object.assign(Error(code),{code,status:409,...(details?{details}:{})});};
const string=maxLength=>({type:'string',minLength:1,maxLength});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const RUNTIME_ROUTE_SUBMISSION_TOOL=Object.freeze({type:'function',function:{name:'submit_runtime_route',description:'Submit proposed next source routes or a milestone assessment as data. No route or code is executed by this function.',parameters:object({version:{type:'integer',enum:[1]},status:{type:'string',enum:['continue','milestone_complete','needs_input']},summary:string(600),requiresChoice:{type:'boolean'},candidates:{type:'array',minItems:0,maxItems:4,items:object({id:{type:'string',enum:['c1','c2','c3','c4']},title:string(100),instruction:string(2000),rationale:string(500),tradeoff:string(500),recommended:{type:'boolean'}})}})}});
export function validateRuntimeRoute(value,{hasSource=false}={}){
 if(!exact(value,['version','status','summary','requiresChoice','candidates']))fail('runtime_route_invalid',{field:'route',reason:'exact_fields_required'});
 if(value.version!==1)fail('runtime_route_invalid',{field:'version',reason:'must_equal_1'});
 if(!['continue','milestone_complete','needs_input'].includes(value.status))fail('runtime_route_invalid',{field:'status',reason:'unsupported_value'});
 if(!text(value.summary,600))fail('runtime_route_invalid',{field:'summary',reason:'trimmed_text_1_to_600_required'});
 if(typeof value.requiresChoice!=='boolean')fail('runtime_route_invalid',{field:'requiresChoice',reason:'boolean_required'});
 if(!Array.isArray(value.candidates))fail('runtime_route_invalid',{field:'candidates',reason:'array_required'});
 if(value.status==='milestone_complete'&&!hasSource)fail('runtime_route_source_required');
 if(value.status!=='continue'){if(value.status==='milestone_complete'&&value.requiresChoice||value.candidates.length)fail('runtime_route_invalid');return structuredClone(value);}
 if(value.candidates.length<2||value.candidates.length>4)fail('runtime_route_alternatives_required');
 const titles=new Set();for(const [i,c] of value.candidates.entries()){
  if(!exact(c,['id','title','instruction','rationale','tradeoff','recommended']))fail('runtime_route_invalid',{field:'candidates.'+i,reason:'exact_fields_required'});
  if(c.id!=='c'+(i+1))fail('runtime_route_invalid',{field:'candidates.'+i+'.id',reason:'sequential_id_required'});
  for(const [key,max] of [['title',100],['instruction',2000],['rationale',500],['tradeoff',500]])if(!text(c[key],max))fail('runtime_route_invalid',{field:'candidates.'+i+'.'+key,reason:'trimmed_bounded_text_required',maxLength:max});
  if(typeof c.recommended!=='boolean')fail('runtime_route_invalid',{field:'candidates.'+i+'.recommended',reason:'boolean_required'});
  if(titles.has(c.title.toLowerCase()))fail('runtime_route_invalid',{field:'candidates.'+i+'.title',reason:'unique_title_required'});titles.add(c.title.toLowerCase());
 }
 if(value.candidates.filter(x=>x.recommended).length!==1)fail('runtime_route_recommendation_required');
 return structuredClone(value);
}
// Reversible source routes follow the recommendation by default. Only an explicit host pause policy or the user's Pause action stops selection.
export function runtimeRouteRequiresPause(route,{pauseAtDecisionOptions=false}={}){return route?.status==='continue'&&pauseAtDecisionOptions===true;}
// The live object owns only the current unexecuted choice. History is immutable
// emitted evidence. Selecting never starts a tool, changes budget or resumes work.
export function createRuntimeRouteControl({sessionId,runId,signal,isPaused,emit}){
 let current=null,closed=false;
 const active=()=>{if(closed||signal?.aborted)fail('runtime_route_not_active');};
 return {
  open({decisionId,taskId,workStepId,parentCandidateRevision,route}){active();if(current&&!current.locked)fail('runtime_route_unsettled');const valid=validateRuntimeRoute(route,{hasSource:parentCandidateRevision!==null});if(valid.status!=='continue')fail('runtime_route_not_selectable');const basis={decisionId,taskId,workStepId,parentCandidateRevision,route:valid};current={...basis,routeDigest:sha(basis),selection:null,locked:false};return structuredClone(current);},
  async select(input){active();if(!plain(input)||Object.keys(input).some(k=>!['sessionId','runId','decisionId','routeDigest','candidateId','title','instruction'].includes(k))||input.sessionId!==sessionId||input.runId!==runId)fail('runtime_route_context_mismatch');if(!current||current.locked||input.decisionId!==current.decisionId||input.routeDigest!==current.routeDigest)fail('runtime_route_changed');if(!isPaused())fail('runtime_route_pause_required');const candidate=current.route.candidates.find(x=>x.id===input.candidateId);if(!candidate)fail('runtime_route_candidate_missing');if(input.title!==undefined&&!text(input.title,100)||input.instruction!==undefined&&!text(input.instruction,2000))fail('runtime_route_edit_invalid');const selected={candidateId:candidate.id,title:input.title??candidate.title,instruction:input.instruction??candidate.instruction,selectionActor:'user',edited:input.title!==undefined&&input.title!==candidate.title||input.instruction!==undefined&&input.instruction!==candidate.instruction};current.selection=selected;await emit('work.route.steered',{taskId:current.taskId,decisionId:current.decisionId,routeDigest:current.routeDigest,plannedWorkStepId:current.workStepId,...selected,execution:'not_run',summary:'Pending source route selected by the user; no source tool started.'});return {accepted:true,decisionId:current.decisionId,plannedWorkStepId:current.workStepId,...selected,execution:'not_run'};},
  commit(decisionId){active();if(!current||current.locked||current.decisionId!==decisionId)fail('runtime_route_changed');current.locked=true;const best=current.route.candidates.find(x=>x.recommended),selection=current.selection||{candidateId:best.id,title:best.title,instruction:best.instruction,selectionActor:'model_recommendation',edited:false};return {...structuredClone(selection),decisionId:current.decisionId,routeDigest:current.routeDigest,taskId:current.taskId,workStepId:current.workStepId,parentCandidateRevision:current.parentCandidateRevision};},
  snapshot(){return current?structuredClone(current):null;},
  close(){closed=true;}
 };
}
