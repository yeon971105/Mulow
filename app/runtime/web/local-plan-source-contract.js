// Data-only policy shared by the browser and local host. Never grants provider or Build access.
export const LOCAL_PLAN_SOURCE_PROFILE='reviewed-local-document-author-v1';
export const LOCAL_PLAN_SOURCE_LIMITS=Object.freeze({maxFiles:200,maxSourceBytes:1000000,maxPathLength:240,maxPromptBytes:6000,maxInputBytes:80000,maxBodyBytes:96000,reviewTtlMs:300000});
export const LOCAL_PLAN_SOURCE_POLICY=Object.freeze({profile:LOCAL_PLAN_SOURCE_PROFILE,limits:LOCAL_PLAN_SOURCE_LIMITS,extensions:Object.freeze(['js','jsx','ts','tsx','mjs','cjs','mts','cts','py','java','go','rs','c','cpp','h','hpp','css','html','md','txt','json','yaml','yml','toml','sql','sh']),excludedDirectories:Object.freeze(['.git','.aws','.ssh','.azure','.gcloud','.config','node_modules','vendor','dist','build']),sensitivityPolicy:'conservative-path-and-content-v1',coverage:'complete_selected_files',operation:'document_author_only',maxModelCalls:1});
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fail=code=>{throw Object.assign(Error(code),{code});};
const exactFile=f=>f&&typeof f==='object'&&!Array.isArray(f)&&Object.getPrototypeOf(f)===Object.prototype&&Object.keys(f).sort().join(',')==='content,path';
export function localPlanSourceSensitive(path,text){
 const segments=path.toLowerCase().split('/'),name=segments.at(-1);
 return segments.some(s=>LOCAL_PLAN_SOURCE_POLICY.excludedDirectories.includes(s))||segments.some(s=>/^\.env(?:\.|$)/.test(s))||/^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|credentials?(?:[._-]|$)|secrets?(?:[._-]|$)|(?:private|service)[_-]?key(?:[._-]|$)|(?:service[_-]?account)(?:[._-]|$)|(?:\.npmrc|\.netrc|\.pypirc)$)/i.test(name)||/\.(?:pem|key|p12|pfx|crt|cer|der|keystore|jks|sqlite|sqlite3|db|zip|gz|tar|7z|rar)$/i.test(name)||/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b|(?:password|passwd|api[_ -]?key|secret|access[_ -]?token|authorization)\s*[=:]\s*["']?[^\s"']{6,}/i.test(text);
}
export function validateLocalPlanFiles(files){
 if(!Array.isArray(files)||files.length<1||files.length>LOCAL_PLAN_SOURCE_LIMITS.maxFiles)fail('local_plan_source_file_count');
 const names=new Set(),spellings=new Map();let bytes=0;
 const result=files.map(file=>{
  if(!exactFile(file)||typeof file.path!=='string'||typeof file.content!=='string')fail('local_plan_source_file_invalid');
  const {path,content}=file,parts=path.split('/'),name=parts.at(-1);
  if(!path||path.length>LOCAL_PLAN_SOURCE_LIMITS.maxPathLength||!/^[A-Za-z0-9_./-]+$/.test(path)||parts.some(p=>!p||p==='.'||p==='..'))fail('local_plan_source_path_invalid');
  if(localPlanSourceSensitive(path,content))fail('local_plan_source_sensitive');
  if(!LOCAL_PLAN_SOURCE_POLICY.extensions.includes(name.includes('.')?name.split('.').at(-1).toLowerCase():''))fail('local_plan_source_unsupported_type');
  const folded=path.toLowerCase();
  if(names.has(folded)||[...names].some(n=>n.startsWith(folded+'/')||folded.startsWith(n+'/')))fail('local_plan_source_path_collision');
  for(let i=1;i<=parts.length;i++){const prefix=parts.slice(0,i).join('/'),key=prefix.toLowerCase();if(spellings.has(key)&&spellings.get(key)!==prefix)fail('local_plan_source_path_collision');spellings.set(key,prefix);}
  names.add(folded);
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content))fail('local_plan_source_binary');
  const encoded=encoder.encode(content);if(decoder.decode(encoded)!==content)fail('local_plan_source_utf8_invalid');
  bytes+=encoded.byteLength;if(bytes>LOCAL_PLAN_SOURCE_LIMITS.maxSourceBytes)fail('local_plan_source_too_large');
  return {path,content};
 });
 return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
