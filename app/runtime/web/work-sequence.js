// Runs only owner-requested stages. Every transition follows an awaited result.
// A queued refinement takes effect at a stage boundary, never inside a model call.
export const chatWorkStages=mode=>mode==='plan'?['author']:['agent','build','preview'];
export function createWorkSequence({context,steps,onChange=()=>{},onQueue=()=>{},onConsumed=()=>{},onStop=()=>{}}){
 let active=null,serial=0;
 const identity=c=>JSON.stringify([c.sessionId,c.projectId,c.model]);
 const current=a=>active===a&&identity(context())===a.identity&&!context().blocked;
 const notify=()=>onChange(active?{...active,queue:active.queue.map(x=>({...x}))}:null);
 async function start(text='',stages=['author','design','build','preview']){
  if(active)return false;
  const c=context();if(c.blocked)return false;
  const a={id:++serial,identity:identity(c),sessionId:c.sessionId,projectId:c.projectId,model:c.model,phase:'starting',queue:[],startedAt:Date.now(),stopped:false};active=a;notify();
  let requested=text,list=[...stages],pendingItem=null,ok=false;
  try{
   for(let i=0;i<list.length;i++){
    if(a.stopped||!current(a))return false;
    const stage=list[i];if(typeof steps[stage]!=='function')throw Error('Unknown work stage');
    a.phase=stage;a.stageStartedAt=Date.now();notify();
    const passed=await steps[stage](requested,a);
    if(!current(a)||a.stopped)return false;
    if(passed!==true){a.phase='needs_attention';notify();return false;}
    if((stage==='author'||stage==='agent')&&pendingItem){onConsumed(pendingItem,a);pendingItem=null;}
    // Preserve each exact submitted request. Incorporate it in the saved document
    // before generating more source for an outdated goal.
    if(a.queue.length){pendingItem=a.queue.shift();requested=pendingItem.text;list=[...(pendingItem.stages||['agent','build','preview'])];i=-1;notify();}
   }
   ok=true;a.phase='completed';notify();return true;
  }catch(error){if(active===a){a.phase='needs_attention';a.error=error.message;notify();}return false;}
  finally{if(active===a){a.completed=ok;a.pending=[...(pendingItem?[pendingItem]:[]),...a.queue].map(x=>({...x}));active=null;onChange({...a,finished:true});}}
 }
 return {start,state:()=>active?{...active,queue:active.queue.map(x=>({...x}))}:null,
  enqueue(text,stages=['agent','build','preview']){if(!active||!current(active)||active.stopped||typeof text!=='string'||!text.trim()||text.length>6000||active.queue.length>=8||!Array.isArray(stages)||!stages.length||stages.some(x=>!['agent','author','design','build','preview'].includes(x)))return false;const item={id:'request_'+crypto.randomUUID(),text:text.trim(),stages:[...stages],createdAt:Date.now()};active.queue.push(item);onQueue(item,active);notify();return true;},
  stop(){if(active&&!active.stopped){const stage=active.phase;active.stopped=true;active.phase='stopping';try{onStop({sessionId:active.sessionId,stage});}finally{notify();}}}
 };
}
