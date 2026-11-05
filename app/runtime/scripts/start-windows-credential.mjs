import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
import {startServer} from '../local/server.mjs';

export async function readCredentialFrame(stream){
 const parts=[];let length=0;
 try{
  for await(const part of stream){const b=Buffer.from(part);length+=b.length;if(length>1004){b.fill(0);throw Error('credential_pipe_invalid');}parts.push(b);}
  const frame=Buffer.concat(parts);try{const n=frame.length>=4?frame.readUInt32BE(0):0;if(n<16||n>1000||frame.length!==n+4||frame.subarray(4).some(c=>c<33||c>126))throw Error('credential_pipe_invalid');return frame.subarray(4).toString('ascii');}finally{frame.fill(0);}
 }finally{for(const part of parts)part.fill(0);}
}

export async function main(args=process.argv.slice(2),{input=process.stdin,start=startServer,platform=process.platform}={}){
 if(platform!=='win32'||args.length!==3||args[0]!=='--credential-pipe-v1'||!isAbsolute(args[1])||!/^\d{4,5}$/.test(args[2])||Number(args[2])<1024||Number(args[2])>65535)throw Error('windows_launcher_invalid');
 let key=await readCredentialFrame(input);
 try{return await start({port:Number(args[2]),dataDirectory:args[1],mode:'live',provider:'baseten',key,basetenTermsVerified:true,windowsCredential:true,strongerPlanning:true});}
 finally{key=null;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const app=await main();
  console.log(JSON.stringify({origin:app.origin,mode:'live',credential:'Windows Credential Manager',providerCallsOnStart:0}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0));app.server.closeAllConnections();});
 }catch{console.error('Mulow could not start with the exact Windows credential. No automatic retry.');process.exitCode=2;}
}
