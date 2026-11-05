import {safeJournalPath} from './work-journal.js';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),run=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]{1,100}$/.test(x);
const codes=new Set(['entrypoint_unsupported','dependency_unsupported','trusted_parser_unavailable','trusted_compiler_unavailable','syntax_rejected','source_policy_unsupported','compile_failed','compiler_receipt_invalid']);
const fail=()=>{throw Error('Invalid source verification receipt.');};
export function safeSourceVerification(v,expected={}){
 if(!v||v.execution!=='not_run'||v.tests!=='not_run')fail();
 if(v.status==='unavailable')return {status:'unavailable',execution:'not_run',tests:'not_run'};
 if(v.format!=='mulo-source-verification'||v.version!==1||!['compiled','unsupported','failed'].includes(v.status)||!['reviewed-static-react-v1','static-react-compile-v1'].includes(v.profile)||v.scope!=='complete_assembled_snapshot'||v.browser!=='unverified'||v.approval!=='not_granted'||!run(v.runId)||!run(v.planRunId)||typeof v.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(v.sessionId)||!['sourceRevision','planRevision','sourceDigest','sourceFilesDigest','dependenciesDigest','policyDigest','parserDigest','toolchainDigest'].every(k=>hex(v[k]))||v.baseRevision!==null&&!hex(v.baseRevision))fail();
 for(const k of ['runId','sessionId','planRunId','planRevision','baseRevision'])if(Object.hasOwn(expected,k)&&v[k]!==expected[k])fail();
 const stages=v.status==='compiled'?['drafted','compiled','browser_unverified']:['drafted',v.status];if(JSON.stringify(v.stages)!==JSON.stringify(stages))fail();
 if(!Array.isArray(v.inputs)||!v.inputs.length||v.inputs.length>200)fail();const paths=new Set();let bytes=0;const inputs=v.inputs.map(f=>{if(!f||!safeJournalPath(f.path)||paths.has(f.path.toLowerCase())||!hex(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0||(bytes+=f.bytes)>1000000)fail();paths.add(f.path.toLowerCase());return {path:f.path,sha256:f.sha256,bytes:f.bytes};});
 const eligibility=v.profile==='static-react-compile-v1'?safeInteractiveEligibility(v.interactiveEligibility):null;
 const result={format:v.format,version:1,status:v.status,stages,profile:v.profile,scope:v.scope,execution:'not_run',tests:'not_run',browser:'unverified',approval:'not_granted',inputs};
 if(eligibility)result.interactiveEligibility=eligibility;
 for(const k of ['runId','sessionId','planRunId','planRevision','baseRevision','sourceRevision','sourceDigest','sourceFilesDigest','dependenciesDigest','policyDigest','parserDigest','toolchainDigest'])result[k]=v[k];
 if(v.status==='compiled'){if(!hex(v.outputDigest)||!Number.isSafeInteger(v.outputBytes)||v.outputBytes<1||v.outputBytes>1600000||v.dependencyCompleteness!=='not_asserted'||v.hostScaffoldSupplied!==true||v.hostReactDependenciesSupplied!==true)fail();Object.assign(result,{outputDigest:v.outputDigest,outputBytes:v.outputBytes,dependencyCompleteness:'not_asserted',hostScaffoldSupplied:true,hostReactDependenciesSupplied:true});}
 else {if(!codes.has(v.diagnostic?.code))fail();result.diagnostic={code:v.diagnostic.code,...(v.diagnostic.rule==='source_parse_rejected'?{rule:'source_parse_rejected'}:{}),...(Number.isSafeInteger(v.diagnostic.line)&&v.diagnostic.line>0&&v.diagnostic.line<=100000?{line:v.diagnostic.line}:{})};}
 return result;
}
export function sourceVerificationLabel(v){return v.status==='compiled'?(v.interactiveEligibility?.status==='unsupported'?'Static compilation passed · interactive Preview unsupported · browser behavior unverified':'Static compilation passed · browser behavior unverified'):v.status==='failed'?'Static verification failed · source not published':v.status==='unsupported'?'Static profile unsupported · source unverified':'Static verifier unavailable · build and tests not run';}

const interactiveRules=new Set('computed_access_rejected duplicate_binding event_handler_requires_zero_arguments event_host_escape invalid_root_component invalid_root_mount jsx_spread_rejected missing_hook_import missing_required_entry reserved_binding source_limit source_parse_rejected unknown_global unsafe_property unsupported_array unsupported_assignment unsupported_attribute unsupported_attribute_value unsupported_binding_pattern unsupported_call unsupported_css_syntax unsupported_element unsupported_event_handler unsupported_export unsupported_file_set unsupported_function unsupported_global_capability unsupported_import unsupported_input_type unsupported_jsx unsupported_literal unsupported_object_property unsupported_operator unsupported_react_import unsupported_syntax unsupported_var'.split(' '));
export function safeInteractiveEligibility(value){
 if(!value||!['supported','unsupported','not_assessed'].includes(value.status))fail();
 const result={status:value.status};
 if(value.diagnostic!==undefined){if(value.status!=='unsupported'||value.diagnostic?.code!=='source_policy_unsupported')fail();const d=value.diagnostic;result.diagnostic={code:'source_policy_unsupported'};if(d.rule!==undefined){if(!interactiveRules.has(d.rule))fail();result.diagnostic.rule=d.rule;}if(d.line!==undefined){if(!Number.isSafeInteger(d.line)||d.line<1||d.line>100000)fail();result.diagnostic.line=d.line;}}
 return result;
}

// Only this mechanical host-scaffold envelope mistake may be corrected once.
// Other unsupported capabilities remain unsupported; no policy is broadened.
export function repairableStaticReceipt(r){return r?.status==='failed'&&r.diagnostic?.code==='syntax_rejected'||r?.status==='unsupported'&&r.profile==='static-react-compile-v1'&&r.diagnostic?.code==='source_policy_unsupported'&&Array.isArray(r.inputs)&&r.inputs.length===3&&r.inputs.map(f=>f.path).sort().join('|')==='index.html|src/main.jsx|src/styles.css';}
