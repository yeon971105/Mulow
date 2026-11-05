import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat,readdir,realpath} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const PROFILE='react-node-http-v1';
const LIMITS=Object.freeze({startupMs:60000,lifetimeMs:600000,sourceBytes:5*1024*1024,sourceFiles:200,previewBytes:2*1024*1024});
const LOCAL_IMAGE=/^sha256:[a-f0-9]{64}$/;
const IMAGE=/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
export class RuntimeError extends Error{constructor(code,details={}){super(code);this.code=code;this.details=details;}}
const fail=(code,details)=>{throw new RuntimeError(code,details);};
export function trustedSourceHash(){const h=createHash('sha256');for(const name of ['idle.mjs','build.mjs','serve.mjs','bridge.mjs'])h.update(name+'\0').update(readFileSync(path.join(HERE,'image',name)));return h.digest('hex');}
export function dockerRunner({args,signal,timeoutMs=10000,maxBytes=3*1024*1024,input=null}){
 return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new RuntimeError('runtime_cancelled'));let size=0,out=[],err=[],finished=false;const child=spawn('docker',args,{shell:false,stdio:[input===null?'ignore':'pipe','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME||'/tmp'}});
 if(input!==null){child.stdin.on('error',()=>{});child.stdin.end(input);}
 const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
 const abort=()=>{child.kill('SIGKILL');finish(new RuntimeError('runtime_cancelled'));},timer=setTimeout(()=>{child.kill('SIGKILL');finish(new RuntimeError('runtime_command_timeout'));},timeoutMs);
 signal?.addEventListener('abort',abort,{once:true});
 for(const [stream,buffers]of[[child.stdout,out],[child.stderr,err]])stream.on('data',b=>{size+=b.length;if(size>maxBytes){child.kill('SIGKILL');finish(new RuntimeError('runtime_output_limit'));}else buffers.push(b);});
 child.on('error',()=>finish(new RuntimeError('docker_unavailable')));child.on('close',code=>finish(null,{code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')}));
 });
}
export async function inspectSnapshot(directory,sourceRoot){
 const absolute=path.resolve(directory),root=await realpath(sourceRoot);if(!absolute.startsWith(root+path.sep)||absolute.includes(',')||await realpath(absolute)!==absolute)fail('invalid_snapshot_directory');
 const files=[];let size=0,directories=0;async function walk(dir){if(++directories>1000||path.relative(absolute,dir).split(path.sep).length>16)fail('snapshot_limit');for(const name of await readdir(dir)){const p=path.join(dir,name),s=await lstat(p),relative=path.relative(absolute,p).split(path.sep).join('/');if(s.isSymbolicLink()||!s.isFile()&&!s.isDirectory())fail('snapshot_special_file');if(!/^[A-Za-z0-9_.@+/-]+$/.test(relative)||/\.(pem|key|p12|pfx)$/i.test(relative)||relative.split('/').some(x=>/^(\.git|\.env(?:\..*)?|\.ssh|\.aws|node_modules|credentials(?:\..*)?|secrets(?:\..*)?)$/i.test(x)))fail('snapshot_sensitive_or_unsupported_path');if(s.isDirectory()){await walk(p);continue;}size+=s.size;if(size>LIMITS.sourceBytes||files.length>=LIMITS.sourceFiles)fail('snapshot_limit');const data=await readFile(p);if(data.length!==s.size)fail('snapshot_changed');files.push({path:relative,size:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}await walk(absolute);files.sort((a,b)=>a.path.localeCompare(b.path));
 const choose=(candidates,required)=>{const found=candidates.filter(p=>files.some(f=>f.path===p));if(found.length>1||required&&!found.length)fail('unsupported_project_entrypoints');return found[0]||null;};
 return{directory:absolute,frontendEntry:choose(['src/main.jsx','src/main.tsx','src/main.js'],true),serverEntry:choose(['server/index.mjs','server/index.js','server.mjs'],false),sourceHash:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
export function createProjectRuntime({runner=dockerRunner,approvedImage=null,sourceRoot}={}){
 let localEndpoint=null;const handles=new Map(),operations=new Set(),scriptHash=trustedSourceHash();
 const policy=()=>({profile:PROFILE,image:approvedImage,trustedSourceHash:scriptHash,limits:LIMITS});
 const command=async(args,options={})=>{const result=await runner({args:localEndpoint?['--host',localEndpoint,...args]:args,timeoutMs:10000,...options});if(result.code!==0)fail('docker_command_failed',{operation:args.slice(0,2).join(' '),exitCode:result.code});return result;};
 const json=result=>{try{return JSON.parse(result.stdout);}catch{fail('invalid_docker_response');}};
 async function preflight({signal}={}){
  if(!approvedImage||!IMAGE.test(approvedImage)&&!LOCAL_IMAGE.test(approvedImage))fail('approved_runtime_image_required');if(!sourceRoot)fail('owned_source_root_required');
  const contexts=json(await command(['context','inspect'],{signal}));if(!Array.isArray(contexts)||contexts.length!==1||!/^unix:\/\//.test(contexts[0]?.Endpoints?.docker?.Host||''))fail('local_docker_context_required');if(localEndpoint&&localEndpoint!==contexts[0].Endpoints.docker.Host)fail('docker_context_changed');localEndpoint=contexts[0].Endpoints.docker.Host;
  const version=json(await command(['version','--format','{{json .Server}}'],{signal}));if(!/^Docker\b/.test(version?.Platform?.Name||'')||!/linux/i.test(version?.Os||''))fail('supported_docker_engine_required');
  let images;try{images=json(await command(['image','inspect',approvedImage],{signal}));}catch(e){if(e.code==='docker_command_failed')fail('approved_runtime_image_missing');throw e;}
  const image=images?.[0];if(images?.length!==1||!/^sha256:[a-f0-9]{64}$/.test(image?.Id||'')||(LOCAL_IMAGE.test(approvedImage)?image.Id!==approvedImage:!image.RepoDigests?.includes(approvedImage))||image.Config?.Labels?.['org.musepilot.profile']!==PROFILE||image.Config?.Labels?.['org.musepilot.trusted-source-sha256']!==scriptHash||image.Os!=='linux')fail('runtime_image_trust_mismatch');
  return{available:true,imageId:image.Id,imageDigest:approvedImage,profile:PROFILE,trustedSourceHash:scriptHash};
 }
 async function owned(record,{signal}={}){const data=json(await command(['container','inspect',record.containerId],{signal}));const c=data?.[0];if(data?.length!==1||(!record.pending&&c?.Id!==record.containerId)||!/^[a-f0-9]{64}$/.test(c?.Id||'')||c.Image!==record.imageId||c.Config?.Labels?.['org.musepilot.owner']!==record.token||c.Config?.Labels?.['org.musepilot.operation']!==record.operationId)fail('container_ownership_mismatch');record.containerId=c.Id;record.pending=false;return c;}
 async function stop(handle){const r=handles.get(handle);if(!r)fail('unknown_runtime_handle');await owned(r);await command(['container','rm','--force',r.containerId],{timeoutMs:10000});clearTimeout(r.timer);handles.delete(handle);return{stopped:true};}
 async function start({operationId,snapshotDirectory,profile=PROFILE,signal:requestedSignal,onProgress=()=>{}}={}){
  let checked,source,signal;try{if(!/^[-a-zA-Z0-9_]{8,100}$/.test(operationId||''))fail('invalid_runtime_operation');if(profile!==PROFILE)fail('unsupported_runtime_profile');if(operations.has(operationId))fail('runtime_operation_already_started');if(requestedSignal?.aborted)fail('runtime_cancelled');operations.add(operationId);const timeout=AbortSignal.timeout(LIMITS.startupMs);signal=requestedSignal?AbortSignal.any([requestedSignal,timeout]):timeout;
  checked=await preflight({signal});source=await inspectSnapshot(snapshotDirectory,sourceRoot);}catch(error){error.cleanupConfirmed=true;throw error;}const handle=randomUUID(),token=randomUUID(),deadline=Date.now()+LIMITS.startupMs;let record=null;
  const current=()=>{if(signal?.aborted)fail('runtime_cancelled');if(Date.now()>deadline)fail('runtime_start_timeout');};
  const progress=async(phase,extra={})=>{current();await onProgress({phase,...extra});current();};
  try{
   current();record={containerId:'musepilot-'+handle,pending:true,imageId:checked.imageId,token,operationId,expiresAt:Date.now()+LIMITS.lifetimeMs};handles.set(handle,record);const created=await command(['container','create','--pull','never','--name','musepilot-'+handle,'--label','org.musepilot.owner='+token,'--label','org.musepilot.operation='+operationId,'--network','none','--read-only','--user','10001:10001','--cap-drop','ALL','--security-opt','no-new-privileges:true','--cpus','1','--memory','512m','--memory-swap','512m','--pids-limit','64','--restart','no','--log-driver','none','--tmpfs','/out:rw,noexec,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=0700','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001,mode=0700','--mount','type=bind,src='+source.directory+',dst=/source,readonly','--entrypoint','node',checked.imageId,'/opt/runtime/idle.mjs'],{signal,timeoutMs:10000});
   const containerId=created.stdout.trim();if(!/^[a-f0-9]{64}$/.test(containerId))fail('invalid_container_identity');record.containerId=containerId;record.pending=false;await owned(record);await progress('container_created');
   await command(['container','start',containerId],{signal,timeoutMs:10000});await progress('build_started',{command:'node /opt/runtime/build.mjs'});
   const built=await command(['container','exec',containerId,'node','/opt/runtime/build.mjs',source.frontendEntry,source.serverEntry||''],{signal,timeoutMs:Math.max(1,Math.min(40000,deadline-Date.now())),maxBytes:65536});const evidence=json(built);
   if(evidence?.profile!==PROFILE||evidence?.buildExitCode!==0||!Array.isArray(evidence.outputFiles)||!evidence.outputFiles.includes('app.js')||evidence.outputFiles.length>200||evidence.outputFiles.some(p=>typeof p!=='string'||!/^[-A-Za-z0-9_.]+$/.test(p)))fail('invalid_build_evidence');
   await progress('build_passed',{fileCount:evidence.outputFiles.length,exitCode:evidence.buildExitCode});await progress('server_starting',{command:'node /opt/runtime/serve.mjs'});
   await command(['container','exec','--detach',containerId,'node','/opt/runtime/serve.mjs',source.serverEntry?'backend':'frontend'],{signal,timeoutMs:10000});
   let ready=false;while(Date.now()<deadline){current();const probe=await runner({args:['--host',localEndpoint,'container','exec',containerId,'node','/opt/runtime/bridge.mjs','/',...(source.serverEntry?['GET','application/json','backend']:[])],signal,timeoutMs:3000,maxBytes:3*1024*1024});if(probe.code===0){const response=json(probe);if(response.status===200&&response.contentType?.startsWith('text/html')&&(!source.serverEntry||response.backendListening===true)){ready=true;break;}}await new Promise(r=>setTimeout(r,100));}
   if(!ready)fail('preview_not_ready');await progress('preview_ready');record.timer=setTimeout(()=>stop(handle).catch(error=>{record.cleanupError=error.code||'cleanup_failed';}),LIMITS.lifetimeMs);record.timer.unref?.();return{handle,buildPassed:true,previewReady:true,checks:{buildExitCode:0,outputFiles:evidence.outputFiles,frontendEntry:source.frontendEntry,serverEntry:source.serverEntry,sourceHash:source.sourceHash,backendListening:source.serverEntry?true:null},expiresAt:new Date(record.expiresAt).toISOString()};
  }catch(error){if(record){try{await stop(handle);}catch(cleanup){throw new RuntimeError(error.code||'runtime_start_failed',{cleanupRequired:true,cleanupHandle:handle,cleanupCode:cleanup.code||'cleanup_failed'});}}error.cleanupConfirmed=true;throw error;}
 }
 async function fetchPreview(handle,pathname='/',{method='GET',body=null,contentType='application/json',signal}={}){
  if(!['GET','POST'].includes(method)||!['application/json','text/plain'].includes(contentType)||body!==null&&!Buffer.isBuffer(body)||body?.length>65536||method==='GET'&&body?.length)fail('invalid_preview_request');
  const r=handles.get(handle);if(!r)fail('unknown_runtime_handle');if(r.cleanupError)fail('runtime_cleanup_required',{cleanupRequired:true,cleanupCode:r.cleanupError});if(Date.now()>=r.expiresAt)fail('runtime_expired');if(typeof pathname!=='string'||pathname.length>2048||!pathname.startsWith('/')||pathname.startsWith('//')||/[\\\x00-\x20\x7f]/.test(pathname))fail('invalid_preview_path');await owned(r,{signal});
  const value=json(await command(['container','exec',...(method==='POST'?['--interactive']:[]),r.containerId,'node','/opt/runtime/bridge.mjs',pathname,method,contentType],{signal,timeoutMs:5000,maxBytes:3*1024*1024,input:method==='POST'?(body||Buffer.alloc(0)):null}));if(!Number.isInteger(value.status)||value.status<100||value.status>599||typeof value.body!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.body)||typeof value.contentType!=='string'||value.contentType.length>120||/[\r\n]/.test(value.contentType))fail('invalid_preview_response');const responseBody=Buffer.from(value.body,'base64');if(responseBody.length>LIMITS.previewBytes)fail('preview_response_too_large');return{status:value.status,contentType:value.contentType,body:responseBody};
 }
 return{policy,preflight,start,stop,fetchPreview};
}
