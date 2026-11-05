import {spawn} from 'node:child_process';
// Build-only trusted profile. A successful compile NEVER grants execution authority.
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const STATIC_REACT_PROFILE='reviewed-static-react-v1';
const versions={react:'19.3.1','react-dom':'19.3.1',scheduler:'0.28.0','esbuild-wasm':'0.25.12'};
export async function compileStaticReactInProcess({files,entryPath='src/main.jsx',originalRevision,originalSourceDigest,toolchainRoot=fileURLToPath(new URL('./vendor/static-react-toolchain/',import.meta.url))}){
 if(!hex(originalRevision)||!hex(originalSourceDigest)||!Array.isArray(files)||!files.length||files.length>32)throw Error('static_react_input_invalid');
 const source=new Map();let bytes=0;
 for(const f of files){if(!f||typeof f.path!=='string'||!/^[-A-Za-z0-9_./]+\.(?:jsx?|mjs|css)$/.test(f.path)||f.path.startsWith('/')||f.path.split('/').some(x=>!x||x==='.'||x==='..')||source.has(f.path)||typeof f.content!=='string')throw Error('static_react_file_invalid');bytes+=Buffer.byteLength(f.content);if(bytes>250000)throw Error('static_react_source_limit');source.set(f.path,f.content);}
 if(!source.has(entryPath)||!entryPath.endsWith('.jsx'))throw Error('static_react_entry_invalid');
 // Host-supplied toolchain only. No project paths/config/package.json/plugins are consulted.
 const root=await realpath(toolchainRoot);const manifestBytes=await readFile(path.join(root,'MANIFEST.json'));if(sha(manifestBytes)!=='0bb277cfe80ef52b1923c192bf993b9166f02cda052dc963f869efee5ac2a862')throw Error('static_react_toolchain_manifest');const vendorManifest=JSON.parse(manifestBytes);for(const f of vendorManifest.files){const p=await realpath(path.join(root,f.path));if(!p.startsWith(root+path.sep))throw Error('static_react_toolchain_path');const b=await readFile(p);if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('static_react_toolchain_changed');}const entries={react:'react/index.js','react-dom':'react-dom/index.js','react-dom/client':'react-dom/client.js',scheduler:'scheduler/index.js','esbuild-wasm':'esbuild-wasm/lib/main.js'};const resolve=name=>{if(!entries[name])throw Error('static_react_package_denied');return path.join(root,'packages',entries[name]);};
 const packageRoots=new Map();
 for(const [name,version] of Object.entries(versions)){const location=await realpath(path.join(root,'packages',name)),metadata=JSON.parse(await readFile(path.join(location,'package.json'),'utf8'));if(metadata.version!==version)throw Error('static_react_toolchain_version');packageRoots.set(name,location);}
 const trusted=async p=>{const real=await realpath(p);if(![...packageRoots.values()].some(r=>real.startsWith(r+path.sep)))throw Error('static_react_trusted_path');return real;};
 const esbuild=await import(pathToFileURL(await trusted(resolve('esbuild-wasm'))).href);
 const plugin={name:'fixed-static-source',setup(build){
  build.onResolve({filter:/.*/},async args=>{
   if(args.kind==='entry-point')return {path:entryPath,namespace:'source'};
   if(args.namespace==='source'){
    if(['react','react-dom/client'].includes(args.path))return {path:await trusted(resolve(args.path)),namespace:'trusted'};
    if(!args.path.startsWith('./')&&!args.path.startsWith('../'))throw Error('static_react_import_denied');
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(args.importer),args.path));
    if(!source.has(resolved))throw Error('static_react_import_missing');
    return {path:resolved,namespace:'source'};
   }
   if(args.namespace==='trusted'){
    if(args.path.startsWith('.'))return {path:await trusted(createRequire(args.importer).resolve(args.path)),namespace:'trusted'};
    if(!['react','react-dom','scheduler'].includes(args.path))throw Error('static_react_vendor_import_denied');
    return {path:await trusted(resolve(args.path)),namespace:'trusted'};
   }
   throw Error('static_react_namespace_denied');
  });
  build.onLoad({filter:/.*/,namespace:'source'},args=>({contents:source.get(args.path),loader:args.path.endsWith('.css')?'css':args.path.endsWith('.jsx')?'jsx':'js'}));
  build.onLoad({filter:/.*/,namespace:'trusted'},async args=>({contents:await readFile(await trusted(args.path),'utf8'),loader:'js'}));
 }};
 let result;try{result=await esbuild.build({entryPoints:[entryPath],bundle:true,write:false,outdir:'/static-output',platform:'browser',format:'iife',target:['es2020'],jsx:'transform',define:{'process.env.NODE_ENV':'"production"'},minify:true,sourcemap:false,legalComments:'inline',metafile:true,logLevel:'silent',plugins:[plugin]});}catch{throw Error('static_react_compile_rejected');}
 const js=result.outputFiles.filter(f=>f.path.endsWith('.js')),css=result.outputFiles.filter(f=>f.path.endsWith('.css'));
 if(js.length!==1||css.length>1||result.outputFiles.length!==js.length+css.length||result.outputFiles.some(f=>f.contents.length>750000))throw Error('static_react_output_invalid');
 if(Object.values(result.metafile.outputs).some(o=>o.imports.length))throw Error('static_react_unbundled_import');
 const html='<!doctype html><html><head><meta charset="utf-8"><title>Reviewed derived React preview</title><style>'+(css[0]?.text||'').replace(/<\/style/gi,'<\\/style')+'</style></head><body><div id="root"></div><script>'+js[0].text.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
 const inputs=[...source].sort(([a],[b])=>a.localeCompare(b)).map(([p,c])=>({path:p,sha256:sha(c),bytes:Buffer.byteLength(c)}));
 return {html,manifest:{profile:STATIC_REACT_PROFILE,originalRevision,originalSourceDigest,inputDigest:sha(JSON.stringify(inputs)),inputs,outputSha256:sha(html),suppliedScaffold:'html-root-element-v1',suppliedDependencies:versions,originalDependencyCompleteness:'not_asserted',build:'compiled_only',execution:'not_run',tests:'not_run',runtimeAuthorization:'requires_separate_exact_output_review',limitations:['No backend, dependency installation or generated build scripts','Preview storage is temporary memory; downloads and forms remain blocked']}};
}

// Explicit current Node executable, not an arbitrary older `node` on the user's PATH.
// No provider/service credentials or full parent environment enter this build worker.
export async function compileStaticReact(input,{signal}={}){
 if(signal?.aborted)throw Error('static_react_compile_cancelled');
 const payload=JSON.stringify(input);if(Buffer.byteLength(payload)>1200000)throw Error('static_react_input_limit');
 return new Promise((resolve,reject)=>{
  const env={PATH:path.dirname(process.execPath),...(process.platform==='win32'&&process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
  const child=spawn(process.execPath,[fileURLToPath(new URL('./static-react-profile-worker.mjs',import.meta.url))],{env,stdio:['pipe','pipe','ignore'],windowsHide:true});const output=[];let size=0,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill();reject(Error(error));}else resolve(value);};
  const abort=()=>finish('static_react_compile_cancelled');
  const timer=setTimeout(()=>finish('static_react_compile_timeout'),60000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.on('error',()=>finish('static_react_worker_unavailable'));child.stdin.on('error',()=>finish('static_react_worker_unavailable'));
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1600000)return finish('static_react_output_limit');output.push(chunk);});
  child.on('close',code=>{if(code!==0)return finish('static_react_compile_rejected');try{const result=JSON.parse(Buffer.concat(output).toString('utf8'));if(result.error)return finish(result.error);if(typeof result.html!=='string'||result.manifest?.outputSha256!==sha(result.html))return finish('static_react_output_invalid');finish(null,result);}catch{finish('static_react_output_invalid');}});
  if(!settled)child.stdin.end(payload);
 });
}
