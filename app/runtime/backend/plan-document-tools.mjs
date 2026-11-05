import {SOURCE_CITATIONS_SCHEMA} from '../web/plan-source-evidence.js';
import {PLAN_DOCUMENT_SCHEMA,DOCUMENT_INDEX_SCHEMA,documentShape} from '../web/plan-document.js';
import {PLAN_ARTIFACT_SCHEMA} from '../web/planning-artifact.js';
import {PLAN_SUBMISSION_TOOL,screenPlanJsonText} from './plan-submission-tool.mjs';
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false}),arr=(items,max,min=0)=>({type:'array',items,minItems:min,maxItems:max}),str=(max,min=1)=>({type:'string',minLength:min,maxLength:max}),id=p=>({...str(8),pattern:'^'+p+'[1-9][0-9]{0,2}$'}),refs=p=>arr(id(p),96),p=PLAN_SUBMISSION_TOOL.function.parameters.properties;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;},tool=(name,parameters)=>freeze({type:'function',function:{name,description:'Submit planning data only. No execution, approval, source access or runtime authority is granted.',parameters}});
const authoredDocument=obj(PLAN_DOCUMENT_SCHEMA.properties,[...PLAN_DOCUMENT_SCHEMA.required,'authorAssessment']),resolvedQuestions=arr(obj({question:str(240),answerQuote:str(1000)}),3);
export const DOCUMENT_AUTHOR_TOOL=tool('submit_plan_document',obj({answer:str(1200),document:authoredDocument,resolvedQuestions},['answer','document']));
export const SOURCE_DOCUMENT_AUTHOR_TOOL=tool('submit_source_plan_document',obj({answer:str(1200),document:authoredDocument,resolvedQuestions,sourceCitations:SOURCE_CITATIONS_SCHEMA},['answer','document']));
// Native Muse writer transport uses explicit fields. Reassembly supplies only
// protocol constants; every authored word, question and assessment comes from
// the response and is checked by the original closed document contract.
const dp=PLAN_DOCUMENT_SCHEMA.properties,ap=dp.authorAssessment.properties;
const authorFields={answer:str(1200),title:dp.title,markdown:dp.markdown,readiness:ap.readiness,questions:ap.questions,hypotheses:ap.hypotheses,resolvedQuestions};
const authorRequired=['answer','markdown','readiness','questions','hypotheses'];
export const DOCUMENT_AUTHOR_FIELDS_TOOL=tool('submit_plan_document_fields',obj(authorFields,authorRequired));
export const SOURCE_DOCUMENT_AUTHOR_FIELDS_TOOL=tool('submit_source_plan_document_fields',obj({...authorFields,sourceCitations:SOURCE_CITATIONS_SCHEMA},authorRequired));
export const DOCUMENT_INDEX_TOOL=tool('submit_document_index',obj({index:DOCUMENT_INDEX_SCHEMA}));
export const DOCUMENT_INDEX_FIELDS_TOOL=tool('submit_document_index_fields',DOCUMENT_INDEX_SCHEMA);
export const DOCUMENT_ARCHITECTURE_TOOL=tool('submit_document_architecture',obj({architecture:p.architecture.anyOf[0],dataFlows:arr(obj({...PLAN_ARTIFACT_SCHEMA.properties.dataFlows.items.properties,requirementIds:refs('r')}),64)}));
// Native bounded transport avoids asking the model to duplicate edge tuples.
export const DOCUMENT_ARCHITECTURE_EDGES_TOOL=tool('submit_document_architecture_edges',obj({architecture:p.architecture.anyOf[0],dataFlows:arr(obj({id:PLAN_ARTIFACT_SCHEMA.properties.dataFlows.items.properties.id,description:PLAN_ARTIFACT_SCHEMA.properties.dataFlows.items.properties.description,edgeIndex:{type:'integer',minimum:0,maximum:63},requirementIds:refs('r')}),64)}));
// A document workflow always has an architecture; express existing readiness
// requirements in the provider schema instead of leaving them merely optional.
const documentTasks=structuredClone(p.tasks),documentTaskCoverage=structuredClone(PLAN_ARTIFACT_SCHEMA.properties.taskCoverage);
documentTasks.items.required.push('componentIds');documentTasks.items.properties.componentIds.minItems=1;
documentTaskCoverage.minItems=1;for(const key of ['requirementIds','acceptanceIds','validationIds'])documentTaskCoverage.items.properties[key].minItems=1;
export const DOCUMENT_WORKFLOW_TOOL=tool('submit_document_workflow',obj({tasks:documentTasks,requiredCapabilities:p.requiredCapabilities,implementationProfile:p.implementationProfile,taskCoverage:documentTaskCoverage,validations:PLAN_ARTIFACT_SCHEMA.properties.validations,hypotheses:PLAN_ARTIFACT_SCHEMA.properties.hypotheses,acceptanceCoverage:arr(obj({acceptanceId:id('a'),validationIds:refs('v')}),96),riskCoverage:arr(obj({riskId:id('k'),taskIds:arr({...str(3),pattern:'^t(?:[1-9]|[1-3][0-9]|4[0-8])$'},48)}),32),planningReadiness:p.planningReadiness,clarificationQuestions:p.clarificationQuestions},['tasks','requiredCapabilities','taskCoverage','validations','hypotheses','acceptanceCoverage','riskCoverage','planningReadiness','clarificationQuestions']));
const requirementCoverage=arr(obj({taskId:PLAN_ARTIFACT_SCHEMA.properties.taskCoverage.items.properties.taskId,requirementIds:{...refs('r',64),minItems:1},dataFlowIds:refs('f',64)}),48,1);
export const DOCUMENT_WORKFLOW_REQUIREMENTS_TOOL=tool('submit_document_workflow_requirements',{...DOCUMENT_WORKFLOW_TOOL.function.parameters,properties:{...DOCUMENT_WORKFLOW_TOOL.function.parameters.properties,taskCoverage:requirementCoverage}});
export function documentSubmissionTool(envelope,{edgeReferences=false}={}){if(edgeReferences&&envelope==='document_index_tool')return DOCUMENT_INDEX_FIELDS_TOOL;if(edgeReferences&&envelope==='document_author_tool')return DOCUMENT_AUTHOR_FIELDS_TOOL;if(edgeReferences&&envelope==='source_document_author_tool')return SOURCE_DOCUMENT_AUTHOR_FIELDS_TOOL;if(edgeReferences&&envelope==='document_architecture_tool')return DOCUMENT_ARCHITECTURE_EDGES_TOOL;if(edgeReferences&&envelope==='document_workflow_tool')return DOCUMENT_WORKFLOW_REQUIREMENTS_TOOL;return {source_document_author_tool:SOURCE_DOCUMENT_AUTHOR_TOOL,document_author_tool:DOCUMENT_AUTHOR_TOOL,document_index_tool:DOCUMENT_INDEX_TOOL,document_architecture_tool:DOCUMENT_ARCHITECTURE_TOOL,document_workflow_tool:DOCUMENT_WORKFLOW_TOOL}[envelope]||null;}
// Fixed schema paths and rules only: never include model values or unknown keys.
function documentSchemaIssue(value,schema,path='$',depth=0){
 if(documentShape(value,schema))return null;
 if(depth>24)return {path,rule:'depth'};
 if(schema.anyOf){const options=schema.anyOf.map(s=>documentSchemaIssue(value,s,path,depth+1));return options.sort((a,b)=>b.path.length-a.path.length)[0]||{path,rule:'anyOf'};}
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))return {path,rule:'object_type',actualType:value===null?'null':Array.isArray(value)?'array':typeof value};
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return {path,rule:'object_prototype'};
  if(Object.keys(value).some(k=>['__proto__','constructor','prototype'].includes(k)||!Object.hasOwn(schema.properties,k)))return {path,rule:'unknown_field'};
  for(const k of schema.required)if(!Object.hasOwn(value,k))return {path:path+'.'+k,rule:'required'};
  for(const k of Object.keys(schema.properties))if(Object.hasOwn(value,k)){const issue=documentSchemaIssue(value[k],schema.properties[k],path+'.'+k,depth+1);if(issue)return issue;}
 }
 if(schema.type==='array'){
  if(!Array.isArray(value))return {path,rule:'array_type'};
  if(value.length<schema.minItems||value.length>schema.maxItems)return {path,rule:'array_length'};
  for(let i=0;i<value.length;i++){const issue=documentSchemaIssue(value[i],schema.items,path+'[]',depth+1);if(issue)return issue;}
 }
 if(schema.type==='integer')return {path,rule:Number.isSafeInteger(value)?'integer_bounds':'integer_type'};
 if(typeof value!=='string')return {path,rule:'string_type'};
 if(value.length>(schema.maxLength??Infinity)||value.trim().length<(schema.minLength??0))return {path,rule:'string_length'};
 if(schema.enum&&!schema.enum.includes(value))return {path,rule:'enum'};
 return {path,rule:schema.pattern?'pattern':'shape'};
}
function decodeDocumentArguments(text,envelope,{edgeReferences=false,documentIndex=null},fail){const t=documentSubmissionTool(envelope,{edgeReferences});if(new TextEncoder().encode(text).length>200000)fail('arguments_limit');let value;try{value=JSON.parse(text);}catch(error){const first=text.trim()[0],kind=first==='`'?'markdown_frame':first==='<'?'xml_frame':first==='{'?'object_syntax':first==='['?'array_syntax':'non_json_text',position=String(error?.message||'').match(/position (\d+)/)?.[1];fail('invalid_json',{path:'$',rule:position?'json_syntax_at_'+position:'json_syntax',actualType:kind});}try{screenPlanJsonText(text);}catch{fail('invalid_json',{path:'$',rule:'ambiguous_json_keys',actualType:'json_object'});}// Muse may encode this object once more inside function arguments. Decode only that
// native field, exactly once, then apply the same closed schema and semantic guards.
// The native author tool can similarly wrap its document object once. Only JSON
// decoding is permitted: never invent missing title, assessment, index or prose.
if(['document_author_tool','source_document_author_tool'].includes(envelope)&&typeof value?.document==='string'){try{screenPlanJsonText(value.document);value.document=JSON.parse(value.document);}catch{fail('invalid_nested_json');}}
if(edgeReferences&&envelope==='document_architecture_tool'&&typeof value?.architecture==='string'){try{screenPlanJsonText(value.architecture);value.architecture=JSON.parse(value.architecture);}catch{fail('invalid_nested_json');}}
const core=structuredClone(value);if(envelope==='source_document_author_tool')delete core.sourceCitations;if(!documentShape(core,t.function.parameters))fail('schema_rejected',documentSchemaIssue(core,t.function.parameters));if(edgeReferences&&envelope==='document_index_tool')return {index:value};if(edgeReferences&&['document_author_tool','source_document_author_tool'].includes(envelope)){
 const document={format:'mulow-plan-document',version:1,...(value.title===undefined?{}:{title:value.title}),markdown:value.markdown,index:null,authorAssessment:{readiness:value.readiness,questions:value.questions,hypotheses:value.hypotheses}};
 if(!documentShape(document,authoredDocument))fail('schema_rejected',documentSchemaIssue(document,authoredDocument,'$.document'));
 return {answer:value.answer,document,...(value.resolvedQuestions===undefined?{}:{resolvedQuestions:value.resolvedQuestions}),...(value.sourceCitations===undefined?{}:{sourceCitations:value.sourceCitations})};
}
if(edgeReferences&&envelope==='document_architecture_tool'){if(value.dataFlows.some(f=>f.edgeIndex>=value.architecture.edges.length))fail('edge_reference');return {architecture:value.architecture,dataFlows:value.dataFlows.map(({id,description,edgeIndex,requirementIds})=>{const edge=value.architecture.edges[edgeIndex];return {id,from:edge.from,to:edge.to,label:edge.label??'',type:edge.type??'',protocol:edge.protocol??'',description,requirementIds};})};}if(edgeReferences&&envelope==='document_workflow_tool'){
 if(!documentShape(documentIndex,DOCUMENT_INDEX_SCHEMA))fail('workflow_index_required');
 const requirements=new Map(documentIndex.requirements.map(r=>[r.id,r.acceptanceIds])),validations=new Map(value.acceptanceCoverage.map(a=>[a.acceptanceId,a.validationIds]));
 if(value.taskCoverage.some(r=>r.requirementIds.some(id=>!requirements.has(id))))fail('workflow_requirement_reference');
 value.taskCoverage=value.taskCoverage.map(row=>{const acceptanceIds=[...new Set(row.requirementIds.flatMap(id=>requirements.get(id)))],validationIds=[...new Set(acceptanceIds.flatMap(id=>validations.get(id)||[]))];return {taskId:row.taskId,requirementIds:row.requirementIds,acceptanceIds,validationIds,dataFlowIds:row.dataFlowIds};});
 if(!documentShape(value,DOCUMENT_WORKFLOW_TOOL.function.parameters))fail('workflow_derived_shape');
 }return value;}

export function decodeDocumentSubmission(data,envelope,{edgeReferences=false}={}){const t=documentSubmissionTool(envelope,{edgeReferences}),c=data?.choices,m=c?.[0]?.message,f=m?.tool_calls?.[0]?.function;const fail=(reason,issue=null)=>{throw Object.assign(Error('document_submission_invalid'),{code:'document_submission_invalid',details:{field:'document_submission',reason,...(issue?{schemaPath:issue.path,schemaRule:issue.rule,...(issue.actualType?{schemaActualType:issue.actualType}:{})}:{})}});};if(!t)fail('tool_binding_envelope');if(!Array.isArray(c)||c.length!==1)fail('tool_binding_choices');if(c[0].finish_reason!=='tool_calls')fail('tool_binding_finish');if(m?.role!=='assistant'||m.refusal!=null)fail('tool_binding_message');if(!['',null].includes(m.content))fail(m.content===undefined?'tool_binding_content_missing':typeof m.content==='string'&&!m.content.trim()?'tool_binding_content_whitespace':'tool_binding_content_nonempty');if(!Array.isArray(m.tool_calls)||m.tool_calls.length<1)fail('tool_binding_no_calls');if(m.tool_calls.length!==1)fail('tool_binding_multiple_calls');if(Object.keys(m.tool_calls[0]).some(k=>!['id','type','function'].includes(k)))fail('tool_binding_call_fields');if(typeof m.tool_calls[0].id!=='string'||!m.tool_calls[0].id||m.tool_calls[0].id.length>256||m.tool_calls[0].type!=='function')fail('tool_binding_call_identity');if(!f||Object.keys(f).some(k=>!['name','arguments'].includes(k)))fail('tool_binding_function_fields');if(f.name!==t.function.name)fail('tool_binding_function_name');if(typeof f.arguments!=='string')fail('tool_binding_arguments_type');return decodeDocumentArguments(f.arguments,envelope,{edgeReferences},fail);}
export function decodeDocumentJsonSubmission(data,envelope,{edgeReferences=false,documentIndex=null}={}){
 const fail=(reason,issue=null)=>{throw Object.assign(Error('document_submission_invalid'),{code:'document_submission_invalid',details:{field:'document_submission',reason,...(issue?{schemaPath:issue.path,schemaRule:issue.rule,...(issue.actualType?{schemaActualType:issue.actualType}:{})}:{})}});};
 if(!['document_index_tool','document_architecture_tool','document_workflow_tool'].includes(envelope))fail('json_envelope');
 const choices=data?.choices,message=choices?.[0]?.message;
 if(!Array.isArray(choices)||choices.length!==1)fail('json_choices');
 if(choices[0].finish_reason!=='stop')fail('json_finish');
 if(message?.role!=='assistant'||message.refusal!=null)fail('json_message');
 if(message.tool_calls!=null&&(!Array.isArray(message.tool_calls)||message.tool_calls.length))fail('json_unexpected_tools');
 if(typeof message.content!=='string'||!message.content.trim())fail('json_content');
 // A single JSON Markdown fence is transport framing only. Prose outside it,
 // non-JSON fences and malformed content still fail the exact original schema.
 const raw=message.content.trim(),fenced=raw.match(/^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/);
 return decodeDocumentArguments(fenced?fenced[1]:raw,envelope,{edgeReferences:envelope==='document_index_tool'?false:edgeReferences,documentIndex},fail);
}
