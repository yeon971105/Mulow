// Pure planning state. This module never executes tools or modifies project files.
export const MODES = Object.freeze(['plan', 'ask', 'agent']);
const copy = value => structuredClone(value);
function fail(message) { throw new Error(message); }
export function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 50) fail('invalid_steps');
  const ids = new Set();
  for (const step of steps) {
    if (!step || typeof step.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(step.id) || ids.has(step.id) || step.id === 'goal') fail('invalid_step_id');
    if (typeof step.title !== 'string' || !step.title.trim() || step.title.length > 200 || !Array.isArray(step.dependencies)) fail('invalid_step');
    ids.add(step.id);
  }
  for (const step of steps) if (step.dependencies.some(id => !ids.has(id) || id === step.id)) fail('invalid_dependency');
  const done = new Set();
  for (let i=0;i<steps.length;i++) for (const step of steps) if (step.dependencies.every(id=>done.has(id))) done.add(step.id);
  if (done.size !== steps.length) fail('cyclic_dependencies');
  return steps.map(step=>({id:step.id,title:step.title.trim(),dependencies:[...new Set(step.dependencies)],status:'planned',events:[],artifacts:[],alternatives:[],checkpoint:null}));
}
export function createBlueprint({id, goal, steps}) {
  if (typeof id !== 'string' || !id || typeof goal !== 'string' || !goal.trim()) fail('invalid_blueprint');
  return {id,goal:goal.trim(),revision:1,approvedRevision:null,mode:'plan',steps:validateSteps(steps),history:[]};
}
export function approveBlueprint(blueprint) { const next=copy(blueprint); next.approvedRevision=next.revision; return next; }
export function setMode(blueprint, mode) {
  if (!MODES.includes(mode)) fail('invalid_mode');
  if (mode==='agent' && blueprint.approvedRevision!==blueprint.revision) fail('plan_approval_required');
  return {...copy(blueprint),mode};
}
export function descendants(blueprint, id) {
  if (!blueprint.steps.some(s=>s.id===id)) fail('unknown_step');
  const found=new Set([id]);
  for(let i=0;i<blueprint.steps.length;i++) for(const step of blueprint.steps) if(step.dependencies.some(d=>found.has(d))) found.add(step.id);
  found.delete(id); return [...found];
}
export function readySteps(blueprint) {
  if(blueprint.mode!=='agent' || blueprint.approvedRevision!==blueprint.revision) return [];
  return blueprint.steps.filter(s=>s.status==='planned' && s.dependencies.every(id=>blueprint.steps.find(x=>x.id===id)?.status==='completed')).map(s=>s.id);
}
export function recordEvent(blueprint, stepId, event) {
  const next=copy(blueprint),step=next.steps.find(s=>s.id===stepId);
  if(!step) fail('unknown_step');
  if(!event || typeof event.id!=='string' || typeof event.summary!=='string' || !Number.isFinite(Date.parse(event.time))) fail('invalid_event');
  if(step.events.some(e=>e.id===event.id)) return next;
  const allowed=['observation','started','completed','blocked','failed','cancelled','artifact'];
  if(!allowed.includes(event.type)) fail('invalid_event_type');
  if(event.type==='started' && !readySteps(blueprint).includes(stepId)) fail('step_not_admitted');
  if(event.type==='completed' && (step.status!=='running' || !event.evidenceRef)) fail('completion_evidence_required');
  if(event.type==='artifact' && (!event.artifact || typeof event.artifact.id!=='string')) fail('invalid_artifact');
  // Only user-facing summaries and evidence references are retained, not model reasoning.
  step.events.push({id:event.id,type:event.type,time:event.time,summary:event.summary.slice(0,2000),evidenceRef:event.evidenceRef||null});
  if(event.type==='started') step.status='running';
  if(['completed','blocked','failed','cancelled'].includes(event.type)) step.status=event.type;
  if(event.type==='artifact') step.artifacts.push(copy(event.artifact));
  return next;
}
export function bottlenecks(blueprint) {
  return blueprint.steps.filter(s=>['blocked','failed'].includes(s.status)).map(s=>({id:s.id,status:s.status,waiting:descendants(blueprint,s.id).filter(id=>blueprint.steps.find(x=>x.id===id).status!=='completed')}));
}
export function proposeAlternative(blueprint, stepId, alternative) {
  const next=copy(blueprint),step=next.steps.find(s=>s.id===stepId);
  if(!step || !alternative || typeof alternative.id!=='string' || typeof alternative.title!=='string' || !alternative.title.trim()) fail('invalid_alternative');
  const steps=validateSteps(alternative.steps);
  if(step.alternatives.some(a=>a.id===alternative.id)) fail('duplicate_alternative');
  step.alternatives.push({id:alternative.id,title:alternative.title,steps,provenance:alternative.provenance||'unverified_proposal',status:'proposed'});
  return next;
}
export function chooseAlternative(blueprint, stepId, alternativeId) {
  if(blueprint.steps.some(s=>s.status==='running')) fail('pause_running_work_first');
  const owner=blueprint.steps.find(s=>s.id===stepId),option=owner?.alternatives.find(a=>a.id===alternativeId);
  if(!option) fail('unknown_alternative');
  const next=createBlueprint({id:blueprint.id,goal:blueprint.goal,steps:option.steps});
  next.revision=blueprint.revision+1;
  next.history=[...copy(blueprint.history),{revision:blueprint.revision,steps:copy(blueprint.steps),reason:'alternative_selected',sourceStep:stepId,alternativeId}];
  // Selection prepares a new plan. Approval cannot silently transfer to changed work.
  return next;
}
export function rollbackPreview(blueprint, stepId) {
  const step=blueprint.steps.find(s=>s.id===stepId); if(!step) fail('unknown_step');
  const affected=[stepId,...descendants(blueprint,stepId)];
  return {stepId,checkpoint:copy(step.checkpoint),affected,requiresPause:affected.some(id=>blueprint.steps.find(s=>s.id===id).status==='running'),externalEffectsReversed:false,costsRefunded:false};
}
export function acknowledgeRestoration(blueprint, stepId, receipt) {
  const preview=rollbackPreview(blueprint,stepId);
  if(preview.requiresPause) fail('pause_running_work_first');
  if(!preview.checkpoint || !receipt || receipt.checkpointId!==preview.checkpoint.id || receipt.verified!==true || !receipt.evidenceRef) fail('verified_restoration_required');
  const next=copy(blueprint);
  next.history.push({revision:next.revision,steps:copy(next.steps),reason:'verified_restoration',receipt:copy(receipt)});
  for(const step of next.steps) if(preview.affected.includes(step.id)){step.status='planned';step.artifacts=[];step.events=[];}
  next.revision++;next.approvedRevision=null;next.mode='plan';return next;
}
export function blueprintLayout(blueprint) {
  const depth=new Map();
  for(let i=0;i<blueprint.steps.length;i++) for(const step of blueprint.steps) if(step.dependencies.every(id=>depth.has(id))) depth.set(step.id,step.dependencies.length?1+Math.max(...step.dependencies.map(id=>depth.get(id))):0);
  const lanes=new Map(),nodes=[];
  for(const step of blueprint.steps){const d=depth.get(step.id),lane=lanes.get(d)||0;lanes.set(d,lane+1);nodes.push({id:step.id,x:80+d*260,y:100+lane*150});}
  const goal={id:'goal',x:80+(Math.max(...depth.values())+1)*260,y:100};
  const dependents=new Set(blueprint.steps.flatMap(s=>s.dependencies));
  const edges=blueprint.steps.flatMap(s=>s.dependencies.map(from=>({from,to:s.id}))).concat(blueprint.steps.filter(s=>!dependents.has(s.id)).map(s=>({from:s.id,to:'goal'})));
  return {nodes,goal,edges};
}
