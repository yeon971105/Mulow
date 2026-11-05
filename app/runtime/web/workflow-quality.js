// An advisory about a visibly broad plan, never an invented task or execution event.
export function combinesFullStackWork(plan){
 if(!plan||!Array.isArray(plan.tasks)||plan.tasks.length!==1)return false;
 const nodes=plan.architecture?.nodes;if(!Array.isArray(nodes))return false;
 const labels=nodes.map(n=>[n?.type,n?.id,n?.label].filter(x=>typeof x==='string').join(' ').toLowerCase());
 if(!labels.some(t=>/front[ _-]?end|\bclient\b|\bbrowser\b/.test(t))||!labels.some(t=>/back[ _-]?end|\bapi\b|http\s+server/.test(t)))return false;
 const task=plan.tasks[0],text=String(task?.title||'')+' '+String(task?.instruction||'');
 return /\b(front[ -]?end|client|react|browser|ui)\b/i.test(text)&&/\b(back[ -]?end|server|api)\b/i.test(text);
}
export function requestsSingleWorkflowTask(text){
 return typeof text==='string'&&(/\b(?:only|exactly|just)\s+(?:one|1|a single)\s+(?:workflow\s+)?(?:task|step|node)\b/i.test(text)||/(?:작업|노드|단계)\s*(?:한\s*개|하나|1\s*개)\s*만/.test(text));
}
export function workflowQualityWarning(session,view){
 const plan=session?.pendingPlan;
 if(!plan||plan.runId!==view?.runId||requestsSingleWorkflowTask(plan.goal)||!combinesFullStackWork(plan))return null;
 return 'One task combines frontend and backend. Ask Muse to split the work and its dependencies for clearer progress.';
}
