import {diagnosticType} from './plan-diagnostics.js';
// Explicit proposed task targets only. Never infer mappings from titles or activity.
export const MAX_TASK_COMPONENTS=32;
export const TASK_COMPONENT_GUIDANCE='For tasks with genuinely known affected architecture components, include optional componentIds: an array of up to 32 unique exact IDs from this same response architecture.nodes. Declare only the actual planned targets, not every component. These IDs describe planned scope, never verified implementation or runtime activity. Preserve unchanged explicit mappings when refining the plan; update mappings when their component IDs or scope genuinely change. Alternatives must refer to their own complete architecture, or the retained primary architecture when omitted. Do not infer targets from names, invent IDs, or manufacture mappings for an unknown design; omit componentIds or use [] when unmapped. JSON type is always an array of ID strings, never a string, null, object, labels, or task IDs. Shape example only: architecture.nodes:[{id:"ui",label:"Interface"}], task.componentIds:["ui"]. Do not copy example IDs into a different design. Return nonempty componentIds only with a complete kind:"components" architecture containing every referenced exact node ID; when architecture is absent or unknown, omit componentIds or use [].';
function invalid(reason,taskIndex=null,types={}){throw Object.assign(Error('invalid_component_mapping'),{code:'invalid_component_mapping',details:{field:'componentIds',taskIndex,reason,...types}});}
export function taskComponentFields(task,taskIndex=null){
 if(task.componentIds===undefined)return {};
 const ids=task.componentIds;
 if(!Array.isArray(ids))invalid('expected_type',taskIndex,{expectedType:'array',actualType:diagnosticType(ids)});
 if(ids.length>MAX_TASK_COMPONENTS)invalid('too_long',taskIndex);
 if(ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_.:/-]{1,120}$/.test(id)))invalid('invalid_id',taskIndex);
 if(new Set(ids).size!==ids.length)invalid('duplicate_id',taskIndex);
 return{componentIds:[...ids]};
}
export function validateTaskComponentBindings(tasks,architecture){
 const known=new Set(architecture?.kind==='components'&&Array.isArray(architecture.nodes)?architecture.nodes.map(n=>n.id):[]);
 tasks.forEach((task,index)=>{const {componentIds=[]}=taskComponentFields(task,index);if(componentIds.some(id=>!known.has(id)))invalid('unknown_component',index);});
 return tasks;
}
