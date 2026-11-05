import {createHash} from 'node:crypto';
import {PROJECT_FIELD_SETS,PROJECT_KNOWN_FIELD_NAMES,safeProjectField} from '../../web/project-diagnostics.js';
export const LIMITS = Object.freeze({maxFiles:200,maxBytes:1_000_000,maxMetadataBytes:64_000});
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw Error(code);};
const object = x => x && typeof x==='object' && !Array.isArray(x);
function keys(x,allowed,section,index) {
 const isObject=object(x),extra=isObject?Object.keys(x).filter(k=>!allowed.includes(k)):[],present=isObject?allowed.filter(k=>Object.hasOwn(x,k)):[],missing=isObject?allowed.filter(k=>!Object.hasOwn(x,k)):[];
 if(!isObject||extra.length||missing.length){
  const known=extra.filter(k=>PROJECT_KNOWN_FIELD_NAMES.includes(k)),kind=v=>v===null?'null':Array.isArray(v)?'array':['string','number','boolean','object'].includes(typeof v)?typeof v:'other',counts=new Map();let nestedProjectShape='none';
  for(const k of extra){const v=x[k],t=kind(v);counts.set(t,(counts.get(t)||0)+1);if(object(v)){const matched=PROJECT_FIELD_SETS.project.filter(name=>Object.hasOwn(v,name)).length;if(matched===PROJECT_FIELD_SETS.project.length)nestedProjectShape='complete';else if(matched&&nestedProjectShape==='none')nestedProjectShape='partial';}}
  const issue=!isObject?'expected_object':extra.length&&missing.length?'unexpected_and_missing_fields':extra.length?'unexpected_fields':'missing_fields';
  const error=Error('invalid_fields');error.projectField=safeProjectField({section,index,issue,knownUnexpected:known,otherUnexpected:extra.length-known.length,structure:{...(isObject?{presentExpected:present}:{actualKind:kind(x)}),unexpectedKinds:[...counts].map(([kind,count])=>({kind,count})),nestedProjectShape}});throw error;
 }
}
function string(x, max=240) {if(typeof x!=='string'||!x.trim()||x.length>max||/[\x00-\x1f\x7f]/.test(x))fail('invalid_string');return x;}
export function relativePath(p) {
 string(p); // Portable ASCII subset deliberately excludes Unicode normalization/case aliases.
 if(!/^[A-Za-z0-9_.@+/-]+$/.test(p))fail('unsafe_path');
 const parts=p.split('/');
 if(parts.some(s=>!s||s==='.'||s==='..'||/[.]$/.test(s)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)))fail('unsafe_path');
 if(parts.some(s=>/^(\.git|\.env(?:\..*)?|\.ssh|\.aws|\.local-data|node_modules|credentials(?:\..*)?|secrets(?:\..*)?|budget(?:\..*)?)$/i.test(s))||/\.(pem|key|p12|pfx)$/i.test(p))fail('sensitive_path');
 return p;
}
function freeze(x){if(object(x)||Array.isArray(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
export function validateProject(input, provenance) {
 keys(input,PROJECT_FIELD_SETS.project,'project');
 if(input.format!=='musepilot-project'||input.version!==1||input.complete!==true)fail('incomplete_project');
 if(input.baseRevision!==null&&!/^[a-f0-9]{64}$/.test(input.baseRevision))fail('invalid_base_revision');
 keys(provenance,PROJECT_FIELD_SETS.provenance,'provenance');
 string(provenance.runId,120);string(provenance.planRevision,120);
 if(!Array.isArray(provenance.taskIds)||!provenance.taskIds.length||provenance.taskIds.length>200)fail('invalid_source_tasks');
 provenance.taskIds.forEach(s=>string(s,120));
 if(!Array.isArray(input.files)||!input.files.length||input.files.length>LIMITS.maxFiles)fail('file_limit');
 const names=new Set(),spellings=new Map();let bytes=0;
 const files=input.files.map((f,index)=>{
 keys(f,PROJECT_FIELD_SETS.file,'file',index);const p=relativePath(f.path),key=p.toLowerCase();
 const segments=p.split('/');for(let i=1;i<=segments.length;i++){const prefix=segments.slice(0,i).join('/'),folded=prefix.toLowerCase();if(spellings.has(folded)&&spellings.get(folded)!==prefix)fail('path_collision');spellings.set(folded,prefix);}
 if(names.has(key)||[...names].some(n=>n.startsWith(key+'/')||key.startsWith(n+'/')))fail('path_collision');names.add(key);
 if(typeof f.content!=='string'||Buffer.from(f.content).toString('utf8')!==f.content)fail('invalid_text');
 bytes+=Buffer.byteLength(f.content);if(bytes>LIMITS.maxBytes)fail('byte_limit');
 return {path:p,content:f.content,sha256:sha256(f.content),bytes:Buffer.byteLength(f.content)};
 }).sort((a,b)=>a.path<b.path?-1:1);
 if(!Array.isArray(input.entrypoints)||!input.entrypoints.length||input.entrypoints.length>20)fail('missing_entrypoints');
 const entrypoints=input.entrypoints.map((e,index)=>{keys(e,PROJECT_FIELD_SETS.entrypoint,'entrypoint',index);relativePath(e.path);if(!files.some(f=>f.path===e.path))fail('missing_entrypoint_file');return {path:e.path,purpose:string(e.purpose,500)};});
 if(!Array.isArray(input.dependencies)||input.dependencies.length>200)fail('invalid_dependencies');
 const dependencies=input.dependencies.map((d,index)=>{keys(d,PROJECT_FIELD_SETS.dependency,'dependency',index);return {name:string(d.name),version:string(d.version),ecosystem:string(d.ecosystem,60)};});
 if(!Array.isArray(input.verificationIntents)||input.verificationIntents.length>40)fail('invalid_verification_intents');
 const verificationIntents=input.verificationIntents.map((v,index)=>{keys(v,PROJECT_FIELD_SETS.verificationIntent,'verificationIntent',index);return {id:string(v.id,80),description:string(v.description,1000),status:'not_run'};});
 const manifest={format:'musepilot-project-bundle',version:1,baseRevision:input.baseRevision,source:{runId:provenance.runId,planRevision:provenance.planRevision,taskIds:[...provenance.taskIds]},status:'generated_unverified',execution:'not_run',tests:'not_run',sdkConnected:false,entrypoints,dependencies,verificationIntents,files:files.map(({content,...f})=>f),limits:LIMITS};
 if(Buffer.byteLength(JSON.stringify(manifest))>LIMITS.maxMetadataBytes)fail('metadata_limit');
 const revision=sha256(JSON.stringify(manifest));
 return freeze({manifest:{...manifest,revision},files});
}
