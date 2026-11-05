import {SOURCE_CITATIONS_SCHEMA} from '../web/plan-source-evidence.js';
import {PLAN_ARTIFACT_SCHEMA} from '../web/planning-artifact.js';
// Fixed model-output data envelopes. No function is executed, no approval granted.
const str=(maxLength,minLength=0)=>({type:'string',minLength,maxLength});
const list=(items,maxItems,minItems=0)=>({type:'array',items,minItems,maxItems});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const nullable=s=>({anyOf:[s,{type:'null'}]});
const enumeration=values=>({type:'string',enum:values});
const taskId=enumeration(Array.from({length:48},(_,i)=>'t'+(i+1)));
const componentId={...str(120,1),pattern:'^[A-Za-z0-9_.:/-]+$'};
const task=obj({id:taskId,title:str(100,1),instruction:str(2000,1),dependencies:list(taskId,47),role:enumeration(['implementation','review','research']),outputKind:enumeration(['artifact','architecture']),componentIds:list(componentId,32),phaseId:enumeration(Array.from({length:8},(_,i)=>'p'+(i+1))),phaseTitle:str(100,1)},['id','title','instruction','dependencies','role','outputKind']);
const node=obj({id:componentId,label:str(160,1),type:str(40),description:str(2000),responsibilities:list(str(300),12),interfaces:list(str(300),12),dataOwnership:list(str(300),12),boundary:str(160),designStatus:enumeration(['required','proposed','unspecified']),rationale:str(2000),parentId:componentId,groupId:componentId},['id','label']);
const architecture=obj({format:enumeration(['musepilot-architecture']),version:{type:'integer',enum:[1]},kind:enumeration(['components','interaction-flow']),nodes:list(node,100,1),edges:list(obj({from:componentId,to:componentId,label:str(250),type:str(80),protocol:str(80)},['from','to']),300),groups:list(obj({id:componentId,label:str(160),parentId:componentId},['id','label']),100),assumptions:list(str(1000),12),designDecisions:list(str(1000),12),designAlternatives:list(str(1000),12)},['format','version','kind','nodes','edges']);
const capabilities=list(enumeration(['frontend_compile','frontend_browser_tests','backend_runtime','backend_tests','database_migrations','persistence_tests','integration_tests','security_tests','accessibility_tests','deployment_health','declarative_schema_validation','local_crud_runtime']),12,1);
const questions=list(str(240,1),3);
const choices=list(obj({questionIndex:{type:'integer',minimum:0,maximum:2},options:list(obj({id:enumeration(['1','2']),label:str(240,1)}),2,2)}),3);
const alternative=obj({id:enumeration(['alt1','alt2','alt3']),taskId,title:str(100,1),instruction:str(2000,1),tasks:list(task,48,1),architecture,componentIds:list(componentId,32),rationale:str(1000,1),predictionBasis:str(1000,1),uncertainty:str(1000,1),estimatedEffort:str(300,1),tradeoffs:list(str(300,1),5),recommended:{type:'boolean'}},['id','taskId','title']);
const metadata={goalTitle:str(80,1),goalSummary:str(240,1)};
const implementationProfile=obj({id:enumeration(['trusted-declarative-crud-v1']),scope:enumeration(['local_single_user']),sourceKind:enumeration(['declarative_schema']),runtime:enumeration(['trusted_host_sqlite']),limitations:list(enumeration(['no_generated_code','no_external_services','no_multi_user','no_realtime','no_deployment','no_migrations','no_custom_interactions','no_filter_sort','no_schema_changes']),9,9)});
const common={implementationProfile,tasks:list(task,48,1),architecture:nullable(architecture),requiredCapabilities:capabilities,clarificationQuestions:questions,clarificationChoices:choices,alternatives:list(alternative,3),...metadata};
const readiness=enumeration(['needs_clarification','ready_for_review']);
const initial=obj({...common,assistantMessage:str(1200,1),planningReadiness:readiness},['tasks','clarificationQuestions','assistantMessage']);
const proposal=obj({...common,summary:str(1000,1),goal:str(6000,1),goalUpdate:obj({goal:str(6000,1),...metadata})},['summary','tasks','clarificationQuestions']);
const conversation=obj({answer:str(3000,1),proposal:nullable(proposal),goalMetadata:obj(metadata),planningReadiness:readiness,clarificationQuestions:questions,clarificationChoices:choices},['answer','proposal']);
const modernInitialRequired=[...initial.required,'planningReadiness','planArtifact'];
const modernProposalRequired=[...proposal.required.filter(key=>key!=='summary'),'planArtifact'];
const modernConversationRequired=[...conversation.required,'planningReadiness'];
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const tool=(name,parameters)=>freeze({type:'function',function:{name,description:'Submit the complete planning response as data only. This does not approve a plan, execute code, call a tool, or grant runtime authority.',parameters}});
export const PLAN_SUBMISSION_TOOL=tool('submit_plan',initial);
export const PLAN_PROPOSAL_SUBMISSION_TOOL=tool('submit_plan_proposal',conversation);
export const SEMANTIC_PLAN_SUBMISSION_TOOL=tool('submit_plan',obj({...initial.properties,planArtifact:PLAN_ARTIFACT_SCHEMA},modernInitialRequired));
export const SEMANTIC_PLAN_PROPOSAL_SUBMISSION_TOOL=tool('submit_plan_proposal',obj({...conversation.properties,proposal:nullable(obj({...proposal.properties,planArtifact:PLAN_ARTIFACT_SCHEMA},modernProposalRequired))},modernConversationRequired));
export const SOURCE_PLAN_SUBMISSION_TOOL=tool('submit_plan',obj({...SEMANTIC_PLAN_SUBMISSION_TOOL.function.parameters.properties,sourceCitations:SOURCE_CITATIONS_SCHEMA},modernInitialRequired));
export const SOURCE_PLAN_PROPOSAL_SUBMISSION_TOOL=tool('submit_plan_proposal',obj({...conversation.properties,proposal:nullable(obj({...proposal.properties,planArtifact:PLAN_ARTIFACT_SCHEMA,sourceCitations:SOURCE_CITATIONS_SCHEMA},modernProposalRequired))},modernConversationRequired));
export const PLAN_SUBMISSION_MAX_BYTES=200000;
export function planSubmissionTool(envelope){return envelope==='source_plan_tool'?SOURCE_PLAN_SUBMISSION_TOOL:envelope==='source_plan_proposal_tool'?SOURCE_PLAN_PROPOSAL_SUBMISSION_TOOL:envelope==='semantic_plan_tool'?SEMANTIC_PLAN_SUBMISSION_TOOL:envelope==='semantic_plan_proposal_tool'?SEMANTIC_PLAN_PROPOSAL_SUBMISSION_TOOL:envelope==='plan_tool'?PLAN_SUBMISSION_TOOL:envelope==='plan_proposal_tool'?PLAN_PROPOSAL_SUBMISSION_TOOL:null;}
const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v==='object'?'object':typeof v;
// Only fixed schema vocabulary is interpreted. Values and unknown property names
// never appear in diagnostics. Relationship/lineage validators still run later.
function shape(v,s,depth=0){
 if(depth>24)return false;if(s.anyOf)return s.anyOf.some(x=>shape(v,x,depth+1));
 if(s.type==='integer'){if(!Number.isSafeInteger(v))return false;}else if(type(v)!==s.type)return false;
 if(s.enum&&!s.enum.includes(v))return false;
 if(typeof v==='string')return v.length>=(s.minLength||0)&&(s.maxLength===undefined||v.length<=s.maxLength)&&(!s.pattern||new RegExp(s.pattern).test(v));
 if(typeof v==='number')return (s.minimum===undefined||v>=s.minimum)&&(s.maximum===undefined||v<=s.maximum);
 if(Array.isArray(v))return v.length>=s.minItems&&v.length<=s.maxItems&&v.every(x=>shape(x,s.items,depth+1));
 if(v&&typeof v==='object')return Object.keys(v).every(k=>!['__proto__','prototype','constructor'].includes(k)&&Object.hasOwn(s.properties,k))&&s.required.every(k=>Object.hasOwn(v,k))&&Object.entries(v).every(([k,x])=>shape(x,s.properties[k],depth+1));
 return true;
}
// Diagnostic-only traversal of the trusted schema after the unchanged validator
// rejects. Paths never contain received property names or array indices.
export function planSubmissionIssues(value,envelope){
 const schema=planSubmissionTool(envelope)?.function.parameters;if(!schema)return [];
 const issues=[],seen=new Set();let visits=0;const count=n=>Math.min(200000,Math.max(0,n));
 const actual=v=>v===undefined?'missing':type(v),expected=s=>s.anyOf?'union':s.type;
 const add=(path,reason,v,s,extra={})=>{const item={path,reason,actualType:actual(v),expectedType:expected(s),...extra},key=JSON.stringify(item);if(issues.length<8&&!seen.has(key)){seen.add(key);issues.push(item);}};
 function walk(v,s,path,depth=0){
  if(issues.length>=8||++visits>4096||depth>24)return;
  if(s.anyOf){if(s.anyOf.some(branch=>shape(v,branch)))return;const branch=s.anyOf.find(branch=>branch.type===type(v)||(branch.type==='integer'&&typeof v==='number'));if(branch)return walk(v,branch,path,depth+1);add(path,'type_mismatch',v,s);return;}
  if(s.type==='integer'?!Number.isSafeInteger(v):type(v)!==s.type){add(path,'type_mismatch',v,s);return;}
  if(s.enum&&!s.enum.includes(v)){add(path,'enum_mismatch',v,s);return;}
  if(typeof v==='string'){if(v.length<(s.minLength||0)||(s.maxLength!==undefined&&v.length>s.maxLength))add(path,'string_length',v,s,{length:count(v.length)});if(s.pattern&&!new RegExp(s.pattern).test(v))add(path,'pattern_mismatch',v,s);return;}
  if(typeof v==='number'){if((s.minimum!==undefined&&v<s.minimum)||(s.maximum!==undefined&&v>s.maximum))add(path,'numeric_range',v,s);return;}
  if(Array.isArray(v)){if(v.length<s.minItems||v.length>s.maxItems)add(path,'array_length',v,s,{length:count(v.length)});for(const child of v){if(issues.length>=8||visits>=4096)break;walk(child,s.items,path+'[]',depth+1);}return;}
  if(v&&typeof v==='object'){
   for(const key of s.required)if(!Object.hasOwn(v,key))add(path+'.'+key,'missing_required',undefined,s.properties[key]);
   let unknown=0;for(const key of Object.keys(v))if(['__proto__','prototype','constructor'].includes(key)||!Object.hasOwn(s.properties,key))unknown++;
   if(unknown)add(path,'additional_property',v,s,{count:count(unknown)});
   for(const[key,child]of Object.entries(s.properties)){if(issues.length>=8||visits>=4096)break;if(Object.hasOwn(v,key))walk(v[key],child,path+'.'+key,depth+1);}
  }
 }
 walk(value,schema,'$');
 if(!issues.length&&visits>=4096)add('$','diagnostic_limit',value,schema);
 return issues;
}

export function planSubmissionShape(value){const out={rootType:['object','array','null','string','number','boolean'].includes(type(value))?type(value):'missing'};if(value&&type(value)==='object')for(const key of ['tasks','architecture','clarificationQuestions','requiredCapabilities','assistantMessage','answer','proposal'])out[key]={present:Object.hasOwn(value,key),type:Object.hasOwn(value,key)?type(value[key]):'missing'};return out;}
function fail(reason,value,issues){const e=Error('plan_submission_invalid');e.code='plan_submission_invalid';e.details={field:'plan_submission',reason,...(value===undefined?{}:{shape:planSubmissionShape(value)}),...(issues?{schemaIssues:issues}:{})};throw e;}
// JSON syntax is validated first. Scan every string token before discarding any
// duplicate members; reject decoded duplicate keys and screen even shadowed data.
export function screenPlanJsonText(text,secret){
 const stack=[];for(const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)){
  const raw=token[0];if(raw==='{'){stack.push(new Set());continue;}if(raw==='['){stack.push(null);continue;}if(raw==='}'||raw===']'){stack.pop();continue;}
  const decoded=JSON.parse(raw);if(secret&&decoded.includes(secret))throw Error('relay_sensitive_response');
  if(/^\s*:/.test(text.slice(token.index+raw.length))){const keys=stack.at(-1);if(!keys||keys.has(decoded)||['__proto__','prototype','constructor'].includes(decoded))throw Error('relay_provider_response_invalid');keys.add(decoded);}
 }
}
export function decodePlanSubmission(data,envelope){
 const expected=planSubmissionTool(envelope);if(!expected)fail('unreviewed_envelope');
 if(!data||!Array.isArray(data.choices)||data.choices.length!==1)fail('choice_count');
 const choice=data.choices[0],m=choice?.message;if(choice?.finish_reason!=='tool_calls')fail('finish_reason');
 if(!m||m.role!=='assistant'||m.refusal!=null||!(m.content===null||m.content===''))fail('message_shape');
 if(!Array.isArray(m.tool_calls)||m.tool_calls.length!==1)fail('tool_count');const call=m.tool_calls[0];
 if(!call||Object.keys(call).some(k=>!['id','type','function'].includes(k))||!call.function||Object.keys(call.function).some(k=>!['name','arguments'].includes(k))||call.type!=='function'||typeof call.id!=='string'||!call.id||call.id.length>256||call.function?.name!==expected.function.name||typeof call.function.arguments!=='string')fail('tool_binding');
 const args=call.function.arguments;if(new TextEncoder().encode(args).byteLength>PLAN_SUBMISSION_MAX_BYTES)fail('arguments_too_large');
 let value;try{value=JSON.parse(args);}catch{fail('arguments_not_json');}
 try{screenPlanJsonText(args);}catch{fail('ambiguous_arguments');}
 // Optional malformed citations are quarantined by the host, not a reason to discard useful core Plan data.
 const core=structuredClone(value);if(envelope==='source_plan_tool'&&core&&typeof core==='object')delete core.sourceCitations;if(envelope==='source_plan_proposal_tool'&&core?.proposal&&typeof core.proposal==='object')delete core.proposal.sourceCitations;
 if(!shape(core,expected.function.parameters))fail('schema_rejected',value,planSubmissionIssues(core,envelope));
 return value;
}
