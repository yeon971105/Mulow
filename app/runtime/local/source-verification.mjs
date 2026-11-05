// Complete-snapshot, build-only evidence. Never grants execution or Preview authority.
import {relativePath} from '../backend/project-output/contract.mjs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {compileStaticReact,STATIC_REACT_PROFILE} from './static-react-profile.mjs';
import {trustedReactParser,PARSER_MANIFEST_DIGEST} from './static-react-policy-loader.mjs';
import {validateSupportedReactSource} from './static-react-source-policy.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const policyDigest=sha(readFileSync(new URL('./static-react-source-policy.mjs',import.meta.url)));
const suppliedDependencies={react:'19.3.1','react-dom':'19.3.1',scheduler:'0.28.0','esbuild-wasm':'0.25.12'};
const toolchainDigest='0bb277cfe80ef52b1923c192bf993b9166f02cda052dc963f869efee5ac2a862';
const rules=new Set('computed_access_rejected duplicate_binding event_handler_requires_zero_arguments event_host_escape invalid_root_component invalid_root_mount jsx_spread_rejected missing_hook_import missing_required_entry reserved_binding source_limit source_parse_rejected unknown_global unsafe_property unsupported_array unsupported_assignment unsupported_attribute unsupported_attribute_value unsupported_binding_pattern unsupported_call unsupported_css_syntax unsupported_element unsupported_event_handler unsupported_export unsupported_file_set unsupported_function unsupported_global_capability unsupported_import unsupported_input_type unsupported_jsx unsupported_literal unsupported_object_property unsupported_operator unsupported_react_import unsupported_syntax unsupported_var'.split(' '));
const fail=code=>{throw Object.assign(Error(code),{code});};
const keys=['owner','sessionId','runId','planRunId','sourceRevision'];
function binding(value){
 if(!value||typeof value.owner!=='string'||!value.owner||value.owner.length>256||typeof value.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(value.sessionId)||!['runId','planRunId'].every(k=>typeof value[k]==='string'&&/^run_[A-Za-z0-9-]{1,100}$/.test(value[k]))||!hex(value.sourceRevision))fail('source_verification_binding_invalid');
 return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
function snapshot(value,expected){
 if(!value||keys.some(k=>value[k]!==expected[k]))fail('source_verification_binding_mismatch');
 if(!Array.isArray(value.files)||!value.files.length||value.files.length>200||!Array.isArray(value.dependencies)||value.dependencies.length>200||!Array.isArray(value.entrypoints)||value.entrypoints.length>20)fail('source_verification_snapshot_invalid');
 const seen=new Set();let bytes=0;
 const files=value.files.map(f=>{
  if(!f||typeof f.path!=='string'||f.path.length>240||!/^[A-Za-z0-9_.@+/-]+$/.test(f.path)||f.path.startsWith('/')||f.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(f.path.toLowerCase())||typeof f.content!=='string')fail('source_verification_snapshot_invalid');
  try{relativePath(f.path);}catch{fail('source_verification_snapshot_invalid');}seen.add(f.path.toLowerCase());bytes+=Buffer.byteLength(f.content);if(bytes>1000000)fail('source_verification_snapshot_invalid');
  return {path:f.path,content:f.content,sha256:sha(f.content),bytes:Buffer.byteLength(f.content)};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const dependencies=value.dependencies.map(d=>{if(!d||typeof d.name!=='string'||!d.name||d.name.length>240||typeof d.version!=='string'||d.version.length>240||typeof d.ecosystem!=='string'||d.ecosystem.length>60)fail('source_verification_snapshot_invalid');return {name:d.name,version:d.version,ecosystem:d.ecosystem};}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const entrypoints=value.entrypoints.map(e=>{if(!e||typeof e.path!=='string'||typeof e.purpose!=='string'||e.path.length>240||e.purpose.length>500)fail('source_verification_snapshot_invalid');return {path:e.path,purpose:e.purpose};}).sort((a,b)=>a.path.localeCompare(b.path));
 const inputs=files.map(({content,...row})=>row),sourceFilesDigest=sha(JSON.stringify(inputs)),dependenciesDigest=sha(JSON.stringify(dependencies));
 return {files,dependencies,entrypoints,inputs,sourceFilesDigest,dependenciesDigest,sourceDigest:sha(JSON.stringify({sourceFilesDigest,dependenciesDigest,entrypoints}))};
}
function diagnostic(code,rule){return {code,...(rules.has(rule?.code)?{rule:rule.code}:{}),...(Number.isSafeInteger(rule?.line)&&rule.line>0&&rule.line<=100000?{line:rule.line}:{})};}
export function createSourceVerifier({loadSnapshot,compile=compileStaticReact}){
 if(typeof loadSnapshot!=='function'||typeof compile!=='function')throw Error('source_verification_configuration_invalid');
 return {async verify(input,{signal}={}){
  const checkCancelled=()=>{if(signal?.aborted)fail('source_verification_cancelled');};checkCancelled();
  const bound=binding(input),before=snapshot(await loadSnapshot({...bound}),bound);checkCancelled();
  const base={format:'mulo-source-verification',version:1,...bound,sourceDigest:before.sourceDigest,sourceFilesDigest:before.sourceFilesDigest,dependenciesDigest:before.dependenciesDigest,inputs:before.inputs,profile:'static-react-compile-v1',interactiveEligibility:{status:'not_assessed'},policyDigest,parserDigest:PARSER_MANIFEST_DIGEST,toolchainDigest,scope:'complete_assembled_snapshot',execution:'not_run',tests:'not_run',browser:'unverified',approval:'not_granted'};
  const finish=async(status,details={})=>{checkCancelled();const after=snapshot(await loadSnapshot({...bound}),bound);checkCancelled();if(after.sourceDigest!==before.sourceDigest)fail('source_verification_stale');return {...base,status,stages:status==='compiled'?['drafted','compiled','browser_unverified']:['drafted',status],...details};};
  if(before.entrypoints.length!==1||before.entrypoints[0].path!=='src/main.jsx')return finish('unsupported',{diagnostic:diagnostic('entrypoint_unsupported')});
  if(before.dependencies.some(d=>!['react','react-dom'].includes(d.name)||d.version!=='19.3.1'||d.ecosystem!=='npm'))return finish('unsupported',{diagnostic:diagnostic('dependency_unsupported')});
  let parse;try{parse=await trustedReactParser();}catch{return finish('failed',{diagnostic:diagnostic('trusted_parser_unavailable')});}
  checkCancelled();
  // Compilation and interactive eligibility are distinct: source is never evaluated here.
  if(before.files.length!==2||!before.files.some(f=>f.path==='src/main.jsx')||!before.files.some(f=>f.path==='src/styles.css')||before.inputs.reduce((n,f)=>n+f.bytes,0)>100000)return finish('unsupported',{diagnostic:diagnostic('source_policy_unsupported',{code:'unsupported_file_set'})});
  try{parse(before.files.find(f=>f.path==='src/main.jsx').content,{ecmaVersion:2022,sourceType:'module',locations:true});}catch(error){return finish('failed',{diagnostic:diagnostic('syntax_rejected',{code:'source_parse_rejected',line:error?.loc?.line})});}
  const policy=validateSupportedReactSource(before.files,parse);
  base.interactiveEligibility=policy.supported?{status:'supported'}:{status:'unsupported',diagnostic:diagnostic('source_policy_unsupported',policy.diagnostic)};
  let output;try{output=await compile({files:before.files.map(({path,content})=>({path,content})),originalRevision:bound.sourceRevision,originalSourceDigest:before.sourceFilesDigest},{signal});}catch(error){checkCancelled();return finish('failed',{diagnostic:diagnostic(error?.message==='static_react_compile_rejected'?'compile_failed':'trusted_compiler_unavailable')});}
  const m=output?.manifest;
  if(typeof output?.html!=='string'||Buffer.byteLength(output.html)>1600000||!m||m.profile!==STATIC_REACT_PROFILE||m.originalRevision!==bound.sourceRevision||m.originalSourceDigest!==before.sourceFilesDigest||m.inputDigest!==before.sourceFilesDigest||JSON.stringify(m.inputs)!==JSON.stringify(before.inputs)||m.outputSha256!==sha(output.html)||m.build!=='compiled_only'||m.execution!=='not_run'||m.tests!=='not_run'||m.suppliedScaffold!=='html-root-element-v1'||JSON.stringify(m.suppliedDependencies)!==JSON.stringify(suppliedDependencies))return finish('failed',{diagnostic:diagnostic('compiler_receipt_invalid')});
  return finish('compiled',{outputDigest:m.outputSha256,outputBytes:Buffer.byteLength(output.html),suppliedScaffold:m.suppliedScaffold,suppliedDependencies:{...suppliedDependencies},dependencyCompleteness:'not_asserted',limitations:['Compilation is not functional verification or execution.','Host React dependencies and an HTML root scaffold are supplied explicitly.','A separate exact-artifact review is still required for any browser Preview.']});
 }};
}

// Read-only identity used to refuse reuse after trusted compiler/policy changes.
export function currentSourceVerificationIdentity(){return Object.freeze({profile:'static-react-compile-v1',policyDigest,parserDigest:PARSER_MANIFEST_DIGEST,toolchainDigest});}
