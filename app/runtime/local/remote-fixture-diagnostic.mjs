// Only implementation-defined schema metadata may leave validation. Never values or Error.message.
const stages=new Set(['tasks','architecture','scope','workgraph']);
const fields=new Set(['tasks','id','title','instruction','dependencies','outputKind','role','phases','title_conflict','instruction_conflict','dependencies_conflict','architecture','format','version','kind','nodes','edges','groups','hierarchy','goal','goalUpdate','clarificationQuestions','summary','evidenceCitation','taskCount','workgraph','unknown','schema','task_count','citation','architecture_task_required','nodes.id','nodes.label','nodes.designStatus','nodes.rationale','edges.from','edges.to','groups.id','assumptions','designDecisions','designAlternatives']);
const types=new Set(['undefined','null','array','object','string','number','boolean','unknown','valid','invalid','other','enum','absent','schema']);
const allowed=new Set(['artifact','architecture','implementation','review','research','components','musepilot-architecture']);
export function safeFixtureDiagnostic(d){
 if(!d||!stages.has(d.stage)||!fields.has(d.field)||!(d.taskIndex===null||Number.isSafeInteger(d.taskIndex)&&d.taskIndex>=0&&d.taskIndex<=5)||!types.has(d.expectedType)||!types.has(d.actualType))return null;
 const out={stage:d.stage,field:d.field,taskIndex:d.taskIndex,expectedType:d.expectedType,actualType:d.actualType};
 if(d.itemIndex===null||Number.isSafeInteger(d.itemIndex)&&d.itemIndex>=0&&d.itemIndex<=299)out.itemIndex=d.itemIndex;
 if(['missing','type','empty','length','duplicate','unknown','self','cycle','invalid','limit','conflict'].includes(d.reason))out.reason=d.reason;
 if(Array.isArray(d.allowedValues)&&d.allowedValues.length<=7&&d.allowedValues.every(v=>allowed.has(v)))out.allowedValues=[...new Set(d.allowedValues)];
 return out;
}
