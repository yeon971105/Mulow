import {build} from '/opt/runtime/node_modules/esbuild/lib/main.js';
import {builtinModules} from 'node:module';
import {mkdir,writeFile,readdir,lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
for(const [name,version] of [['esbuild','0.25.12'],['react','19.1.0'],['react-dom','19.1.0']]){const pkg=JSON.parse(await readFile('/opt/runtime/node_modules/'+name+'/package.json','utf8'));if(pkg.name!==name||pkg.version!==version)throw Error('Reviewed dependency identity mismatch');}
const [front,server]=process.argv.slice(2),fronts=['src/main.jsx','src/main.tsx','src/main.js'],servers=['','server/index.mjs','server/index.js','server.mjs'];
if(!fronts.includes(front)||!servers.includes(server))throw Error('Unsupported fixed entrypoints');
await mkdir('/out/public',{recursive:true});
const builtin=new Set(builtinModules.flatMap(x=>[x,x.replace(/^node:/,''),'node:'+x.replace(/^node:/,'')]));
function imports(browser){return {name:'reviewed-import-policy',setup(b){b.onResolve({filter:/.*/},args=>{if(args.kind==='entry-point')return;const p=args.path;if(p.startsWith('.')||p.startsWith('/')){const resolved=path.resolve(args.resolveDir,p);if(!resolved.startsWith('/source/')&&!resolved.startsWith('/opt/runtime/node_modules/'))return{errors:[{text:'Import outside approved roots'}]};return;}if(browser&&/^(react|react-dom)(\/|$)/.test(p))return; // nodePaths resolves these reviewed dependencies.
 if(args.importer.startsWith('/opt/runtime/node_modules/')&&['scheduler','react','react-dom'].includes(p))return;
 if(!browser&&builtin.has(p))return{path:p.startsWith('node:')?p:'node:'+p,external:true};return{errors:[{text:'Unsupported package import: '+p.slice(0,80)}]};});}};}
await build({entryPoints:['/source/'+front],outfile:'/out/public/app.js',absWorkingDir:'/source',tsconfigRaw:{compilerOptions:{}},bundle:true,platform:'browser',format:'esm',jsx:'automatic',nodePaths:['/opt/runtime/node_modules'],plugins:[imports(true)],loader:{'.png':'dataurl','.jpg':'dataurl','.svg':'dataurl','.woff2':'dataurl'},logLevel:'silent',metafile:false,write:true});
if(server)await build({entryPoints:['/source/'+server],outfile:'/out/server.cjs',absWorkingDir:'/source',tsconfigRaw:{compilerOptions:{}},bundle:true,platform:'node',format:'cjs',plugins:[imports(false)],logLevel:'silent',write:true});
const files=await readdir('/out/public');if(!files.includes('app.js'))throw Error('Missing build output');for(const file of files){const st=await lstat('/out/public/'+file);if(!st.isFile()||st.size>8*1024*1024)throw Error('Unsupported output');}
await writeFile('/out/public/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+(files.includes('app.css')?'<link rel="stylesheet" href="./app.css">':'')+'</head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>');
console.log(JSON.stringify({profile:'react-node-sqlite-v1',buildExitCode:0,outputFiles:[...files,'index.html'].sort()}));
