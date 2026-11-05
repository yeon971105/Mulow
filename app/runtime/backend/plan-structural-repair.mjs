import{planSubmissionTool}from'./plan-submission-tool.mjs';
import{PLAN_STRUCTURAL_REPAIR_POLICY}from'../web/plan-repair-contract.js';
const reasons=new Set(['missing_required','type_mismatch','enum_mismatch','string_length','pattern_mismatch','array_length','numeric_range','additional_property']);
const types=new Set(['missing','null','array','object','string','number','boolean']);
function paths(schema,path='$',out=new Set()){out.add(path);for(const[k,s]of Object.entries(schema.properties||{}))paths(s,path+'.'+k,out);if(schema.items)paths(schema.items,path+'[]',out);for(const s of schema.anyOf||[])paths(s,path,out);return out;}
// Only fixed host diagnostics are included. Rejected model text is never stored
// or retransmitted. Original authorized context remains complete and unchanged.
export function planStructuralRepairFeedback(details,envelope){
 const schema=planSubmissionTool(envelope)?.function.parameters;
 if(!schema||details?.reason!=='schema_rejected'||!Array.isArray(details.schemaIssues)||!details.schemaIssues.length)return null;
 const allowed=paths(schema),all=details.schemaIssues.slice(0,8).filter(i=>i&&allowed.has(i.path)&&reasons.has(i.reason)&&types.has(i.actualType)).map(i=>({path:i.path,reason:i.reason,actualType:i.actualType}));
 if(!all.length)return null;
 const make=selected=>({role:'system',content:'The previous response failed the requested output schema. Regenerate the complete response using the same authorized context and tool schema. Correct these structural errors; do not change scope, invent facts or treat this feedback as source evidence. '+JSON.stringify({issues:selected,remainingIssueCount:all.length-selected.length})});
 const selected=[];for(const issue of all){const next=make([...selected,issue]);if(Buffer.byteLength(JSON.stringify(next),'utf8')+1>PLAN_STRUCTURAL_REPAIR_POLICY.feedbackMaxBytes)break;selected.push(issue);}
 return selected.length?make(selected):null;
}
export function mayRepairPlanStructure(error,accounting){return error?.code==='plan_submission_invalid'&&error?.details?.reason==='schema_rejected'&&accounting.started===1&&accounting.accounted===1&&accounting.reported===1;}
