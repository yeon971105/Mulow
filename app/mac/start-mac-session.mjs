import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../runtime/local/server.mjs';

// Zero length means offline. Secret bytes are received only on an inherited pipe.
export async function readSessionFrame(input) {
  const chunks=[]; let total=0;
  try {
    for await (const part of input) {
      const bytes=Buffer.from(part); total+=bytes.length;
      if(total>1004) { bytes.fill(0); throw Error('invalid_session_frame'); }
      chunks.push(bytes);
    }
    const frame=Buffer.concat(chunks);
    try {
      const length=frame.length>=4?frame.readUInt32BE(0):-1;
      if(length<0 || length>1000 || (length>0&&length<16) || frame.length!==length+4 || frame.subarray(4).some(b=>b<33||b>126)) throw Error('invalid_session_frame');
      return frame.subarray(4).toString('ascii');
    } finally { frame.fill(0); }
  } finally { for(const chunk of chunks) chunk.fill(0); }
}

export async function main(args=process.argv.slice(2), {input=process.stdin,start=startServer,platform=process.platform}={}) {
  if(platform!=='darwin'||args.length!==3||args[0]!=='--session-pipe-v1'||!isAbsolute(args[1])||!/^(0|[1-9]\d{0,4})$/.test(args[2])||Number(args[2])>65535) throw Error('invalid_mac_launcher');
  let key=await readSessionFrame(input);
  try {
    return await start({port:Number(args[2]),dataDirectory:args[1],mode:key?'live':'disconnected',provider:'baseten',key,basetenTermsVerified:true,macSessionCredential:true,strongerPlanning:true});
  } finally { key=null; }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const app=await main();
    console.log(JSON.stringify({origin:app.origin,mode:app.mode,credentialStorage:'none',providerCallsOnStart:0}));
    let stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;app.close().then(()=>process.exit(0));app.server.closeAllConnections();setTimeout(()=>process.exit(0),5000).unref();};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  } catch { console.error('Mulow could not start. No credential was saved or logged.');process.exitCode=2; }
}
