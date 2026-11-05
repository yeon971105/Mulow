import {mergeProjectLineage} from './version-lineage.js';

// Current source is server evidence, not browser-persisted project state.
// A late response cannot be applied after a session, plan, bundle or restore
// changes; the next refresh obtains a fresh observation.
export function createLineageTracker({fetcher=fetch,isValid=()=>true,onUpdate=()=>{}}={}){
 const cache=new Map(),inflight=new Map(),epochs=new Map();
 const stamp=s=>(s.projectBundles||[]).map(b=>b.runId+':'+b.revision).join('|')+'|'+(s.pendingPlan?.runId||'')+'|'+(epochs.get(s.id)||0);
 const current=s=>{const v=cache.get(s.id);return v?.stamp===stamp(s)?v.current:null;};
 const invalidate=s=>{epochs.set(s.id,(epochs.get(s.id)||0)+1);cache.delete(s.id);};
 async function refresh(s,{allowEmpty=false}={}){
  if(!s?.id||!s.projectBundles?.length&&!allowEmpty||!isValid(s)||inflight.has(s.id))return false;
  const token=stamp(s);inflight.set(s.id,token);
  try{
   const response=await fetcher('/api/project-lineage?'+new URLSearchParams({sessionId:s.id}),{cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw Error('lineage_unavailable');
   const x=await response.json();if(!isValid(s)||stamp(s)!==token)return false;
   if(x.sessionId!==s.id){cache.delete(s.id);onUpdate(s,false);return false;}
   const changed=mergeProjectLineage(s,x.items);
   let observed={status:'unconfirmed'};
   if(x.current?.status==='unconfirmed'&&['restore_unconfirmed','linked_restore_unconfirmed'].includes(x.current.reason))observed.reason=x.current.reason;
   if(x.current?.status==='empty')observed={status:'empty'};
   else if(x.current?.status==='known'&&Array.isArray(x.items)&&x.items.length<=200&&x.items.some(i=>i.runId===x.current.runId&&i.revision===x.current.revision&&i.planRunId===x.current.planRunId))observed={status:'known',runId:x.current.runId,revision:x.current.revision,planRunId:x.current.planRunId};
   cache.set(s.id,{stamp:token,current:observed});onUpdate(s,changed);return true;
  }catch{if(isValid(s)&&stamp(s)===token){cache.delete(s.id);onUpdate(s,false);}return false;}
  finally{inflight.delete(s.id);if(isValid(s)&&stamp(s)!==token)queueMicrotask(()=>refresh(s));}
 }
 return {current,invalidate,refresh,pending:s=>inflight.has(s?.id)};
}
