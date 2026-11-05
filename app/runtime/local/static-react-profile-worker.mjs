import {compileStaticReactInProcess} from './static-react-profile.mjs';
const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1200000)process.exit(2);chunks.push(chunk);}
try{const result=await compileStaticReactInProcess(JSON.parse(Buffer.concat(chunks).toString('utf8')));process.stdout.write(JSON.stringify(result));}catch(e){const safe=/^static_react_[a-z_]+$/.test(e?.message||'')?e.message:'static_react_compile_rejected';process.stdout.write(JSON.stringify({error:safe}));}
