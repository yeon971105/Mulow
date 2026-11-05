// Bounded React capability review. Analysis/build never grants execution by itself.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {analyzeReactV2Files} from './react-capability-v2/profile.mjs';
import {EVENT_ADAPTER} from './react-capability-v2/react-policy.mjs';
import {PARSER_MANIFEST_DIGEST} from './static-react-policy-loader.mjs';
import {compileStaticReact} from './static-react-profile.mjs';
import {buildReviewedInteractiveDocument} from './reviewed-interactive-source.mjs';
export const REACT_CAPABILITY_PREVIEW_PROFILE='react-capability-preview-v2';
const POLICY='914e054ee23e0febb9b5173bd42ed0e60444c7fd7fdb03cc78e7efdcaae527be';
const TOOLCHAIN='0bb277cfe80ef52b1923c192bf993b9166f02cda052dc963f869efee5ac2a862';
const VERSIONS={react:'19.3.1','react-dom':'19.3.1',scheduler:'0.28.0','esbuild-wasm':'0.25.12'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const FAILURE=Symbol('react-capability-failure');
const fail=code=>{throw Object.assign(Error('react_capability_'+code),{[FAILURE]:true});};
const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const rows=files=>files.map(f=>({path:f.path,content:f.content,sha256:sha(f.content),bytes:Buffer.byteLength(f.content)})).sort((a,b)=>a.path.localeCompare(b.path));
const hashes=files=>files.map(({content,...row})=>row);
const clone=value=>structuredClone(value);
const identity=()=>({
 policyDigest:sha(['react-policy.mjs','css-policy.mjs','profile.mjs'].map(n=>read('./react-capability-v2/'+n)).join('\0')),
 parserDigest:sha(read('./vendor/static-react-parser/manifest.json')),
 eventAdapterDigest:sha(EVENT_ADAPTER),
 toolchainDigest:sha(read('./vendor/static-react-toolchain/MANIFEST.json')),
 wrapperDigest:sha(read('./reviewed-interactive-source.mjs')),
 serviceDigest:sha(read('./react-capability-preview.mjs')),
 compilerDigest:sha(read('./static-react-profile.mjs')),
});
const INITIAL_IDENTITY=identity();
// Diagnostic strings originate only in pinned trusted policy code, not submitted source.
const DIAGNOSTICS=new Set(['file_set_or_size','dependency_unsupported',...['react-policy.mjs','css-policy.mjs'].flatMap(n=>[...read('./react-capability-v2/'+n).matchAll(/(?:fail\(|\[POLICY_ERROR\]:)'([a-z_]+)'/g)].map(m=>m[1]))]);
const safeDiagnostic=value=>({code:DIAGNOSTICS.has(value?.code)?value.code:'source_policy_unsupported',...(Number.isSafeInteger(value?.line)&&value.line>0&&value.line<=100000?{line:value.line}:{})});
const DERIVATION=['intrinsic_handlers_receive_frozen_scalar_records','css_closed_subset_canonical_serialization'];
const LIMITATIONS=[
 'This bounded React subset is not arbitrary JavaScript or fullstack execution.',
 'Original source is preserved; event handlers receive frozen scalar records and CSS is parsed and serialized.',
 'Event text is capped at 2048 characters; key and code at 32. Native events, DOM refs and native storage are not provided.',
 'No backend, network, downloads, forms, navigation or persistent storage is authorized. Preview state is temporary and resets on reload.',
 'Effects and allocations can hang or crash the browser. Stop is best effort, not a CPU or memory limit.',
 'Capability analysis and browser policies do not establish functional correctness, all-browser isolation, tests passed or Goal completion.',
];
export function createReactCapabilityPreview({owner,loadCurrent,now=()=>Date.now(),compile=compileStaticReact,inspectPolicy=identity}){
 if(typeof owner!=='string'||!owner||owner.length>256||typeof loadCurrent!=='function')fail('owner_required');
 const reviews=new Map(),tickets=new Map();let compiling=false,disposed=false;
 const policy=()=>{let actual;try{actual=inspectPolicy();}catch{fail('policy_changed');}if(JSON.stringify(actual)!==JSON.stringify(INITIAL_IDENTITY)||actual.policyDigest!==POLICY||actual.parserDigest!==PARSER_MANIFEST_DIGEST||actual.toolchainDigest!==TOOLCHAIN)fail('policy_changed');return clone(actual);};
 const prune=()=>{if(disposed)fail('disposed');for(const map of [reviews,tickets])for(const [id,value] of map)if(value.expires<=now())map.delete(id);};
 function current(input){
  if(disposed)fail('disposed');
  policy();
  if(!input||!uuid(input.sessionId)||!['generated','external'].includes(input.sourceKind)||!hex(input.sourceRevision)||typeof input.planRunId!=='string'||!/^run_[A-Za-z0-9-]{1,120}$/.test(input.planRunId))fail('binding_invalid');
  let source;try{source=clone(loadCurrent({owner,sessionId:input.sessionId,sourceKind:input.sourceKind,sourceRevision:input.sourceRevision,planRunId:input.planRunId}));}catch{fail('current_unavailable');}
  if(!source||source.owner!==owner||source.sessionId!==input.sessionId||source.sourceKind!==input.sourceKind||source.revision!==input.sourceRevision||source.planRunId!==input.planRunId||!hex(source.planDigest)||!(source.nativeRevision===null||hex(source.nativeRevision))||source.sourceKind==='generated'&&source.nativeRevision!==source.revision)fail('stale');
  if(!Array.isArray(source.files)||source.files.length!==2||new Set(source.files.map(f=>f?.path)).size!==2||source.files.some(f=>!f||!['src/main.jsx','src/styles.css'].includes(f.path)||typeof f.content!=='string')||source.files.reduce((n,f)=>n+Buffer.byteLength(f.content),0)>100000)fail('source_unsupported');
  if(!Array.isArray(source.dependencies)||!Array.isArray(source.entrypoints)||source.entrypoints.length!==1||source.entrypoints[0]?.path!=='src/main.jsx'||Object.keys(source.entrypoints[0]).some(k=>!['path','purpose'].includes(k))||typeof source.entrypoints[0].purpose!=='string'||source.entrypoints[0].purpose.length>120)fail('source_unsupported');
  source.files=rows(source.files);
  return source;
 }
 function binding(input,source){return {owner,sessionId:input.sessionId,sourceKind:input.sourceKind,sourceRevision:source.revision,nativeRevision:source.nativeRevision,planRunId:source.planRunId,planDigest:source.planDigest,sourceDigest:sha(JSON.stringify({files:source.files,dependencies:source.dependencies,entrypoints:source.entrypoints}))};}
 function bound(record){const source=current(record);if(JSON.stringify(binding(record,source))!==JSON.stringify(record.binding))fail('stale');return source;}
 function metadata(record){const {owner:_owner,...publicBinding}=record.binding;return clone({
  status:'reviewed',supported:true,profile:REACT_CAPABILITY_PREVIEW_PROFILE,
  ...publicBinding,...record.identity,
  originalInputDigest:record.originalInputDigest,transformedInputDigest:record.transformedInputDigest,
  outputDigest:record.outputDigest,originalFiles:record.originalFiles,transformedFiles:record.transformedFiles,
  originalDependencies:record.dependencies,originalEntrypoints:record.entrypoints,
  suppliedDependencies:VERSIONS,suppliedScaffold:'html-root-element-v1',
  derivation:DERIVATION,limitations:LIMITATIONS,execution:'not_run',tests:'not_run',browser:'unverified',
  provenance:'owned_source_transformed_by_bounded_react_capability_policy',expiresAt:new Date(record.expires).toISOString(),
 });}
 return {
  async review(input){
   prune();if(compiling||reviews.size+tickets.size>=16)fail('capacity');
   const source=current(input),captured=binding(input,source),base={...captured,binding:captured};
   compiling=true;
   try{
    const analysis=await analyzeReactV2Files({files:source.files.map(({path,content})=>({path,content})),dependencies:source.dependencies});
    bound(base);
    if(!analysis.supported)return {status:'unsupported',supported:false,profile:REACT_CAPABILITY_PREVIEW_PROFILE,diagnostic:safeDiagnostic(analysis.diagnostic),execution:'not_run',browser:'unverified'};
    const id=policy(),originalFiles=source.files,transformedFiles=rows(analysis.transformedFiles);
    const originalInputDigest=sha(JSON.stringify({files:hashes(originalFiles),dependencies:source.dependencies})),transformedInputDigest=sha(JSON.stringify(hashes(transformedFiles)));
    if(analysis.policyDigest!==id.policyDigest||analysis.parserDigest!==id.parserDigest||analysis.eventAdapterDigest!==id.eventAdapterDigest||analysis.originalDigest!==originalInputDigest||analysis.transformedDigest!==transformedInputDigest||transformedFiles.reduce((n,f)=>n+f.bytes,0)>120000)fail('analysis_invalid');
    const result=await compile({files:transformedFiles.map(({path,content})=>({path,content})),originalRevision:source.revision,originalSourceDigest:transformedInputDigest});
    bound(base);policy();
    const manifest=result?.manifest;
    if(typeof result?.html!=='string'||Buffer.byteLength(result.html)>2000000||manifest?.profile!=='reviewed-static-react-v1'||manifest.originalRevision!==source.revision||manifest.originalSourceDigest!==transformedInputDigest||manifest.inputDigest!==transformedInputDigest||JSON.stringify(manifest.inputs)!==JSON.stringify(hashes(transformedFiles))||manifest.outputSha256!==sha(result.html)||manifest.suppliedScaffold!=='html-root-element-v1'||JSON.stringify(manifest.suppliedDependencies)!==JSON.stringify(VERSIONS)||manifest.build!=='compiled_only'||manifest.execution!=='not_run'||manifest.tests!=='not_run')fail('output_invalid');
    const reviewId='capability_review_'+randomUUID(),record={...base,identity:id,originalFiles,transformedFiles,dependencies:source.dependencies,entrypoints:source.entrypoints,originalInputDigest,transformedInputDigest,outputDigest:sha(result.html),html:result.html,expires:now()+300000};
    reviews.set(reviewId,record);return {reviewId,...metadata(record)};
   }catch(error){if(error?.[FAILURE])throw error;fail('review_unavailable');}finally{compiling=false;}
  },
  start({sessionId,reviewId,outputDigest,approve,acceptBrowserRisk}){
   prune();policy();if(approve!==true||acceptBrowserRisk!==true)fail('consent_required');
   const record=reviews.get(reviewId);if(!record||record.sessionId!==sessionId||record.outputDigest!==outputDigest)fail('review_mismatch');
   bound(record);reviews.delete(reviewId);
   const capabilityId='capability_preview_'+randomUUID(),ticket={...record,used:false,expires:now()+600000};tickets.set(capabilityId,ticket);
   return {...metadata(ticket),capabilityId,url:'/api/react-capability/view?'+new URLSearchParams({sessionId,ticket:capabilityId})};
  },
  view({sessionId,ticket}){
   prune();policy();const record=tickets.get(ticket);if(!record||record.sessionId!==sessionId||record.used)fail('capability_unavailable');
   bound(record);record.used=true;
   const document=buildReviewedInteractiveDocument(record.html);document.headers['Content-Security-Policy']+="; webrtc 'block'";return document;
  },
  stop({sessionId,capabilityId}){prune();const record=tickets.get(capabilityId);if(record&&record.sessionId===sessionId)tickets.delete(capabilityId);return {status:'revoked',note:'Client iframe removal is required; this is not forced CPU termination.'};},
  dispose(){disposed=true;reviews.clear();tickets.clear();},
 };
}
