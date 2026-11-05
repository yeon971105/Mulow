// Local operator approval only; this loader never provisions or pulls an image.
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assertPrivatePathSync} from './private-file-access.mjs';
const IMAGE=/^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/;
export async function readRuntimeImageApproval(directory){
 const file=path.join(directory,'runtime-image-approval.json');let handle;
 try{
  const parent=await lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('unsafe_directory');
  const entry=await lstat(file);if(entry.isSymbolicLink()||!entry.isFile()||entry.nlink!==1)throw Error('unsafe_file');
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const info=await handle.stat();if(!info.isFile()||info.size>4096||info.dev!==entry.dev||info.ino!==entry.ino||(process.platform!=='win32'&&(info.mode&0o077)!==0)||(typeof process.getuid==='function'&&info.uid!==process.getuid()))throw Error('unsafe_file');
  if(process.platform==='win32')assertPrivatePathSync(file);
  const value=JSON.parse(await handle.readFile('utf8'));
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='approved,image'||value.approved!==true||typeof value.image!=='string'||!IMAGE.test(value.image))throw Error('invalid_approval');
  return value.image;
 }catch(error){if(error.code==='ENOENT')return null;throw Object.assign(Error('runtime_image_approval_invalid'),{code:'runtime_image_approval_invalid'});}
 finally{await handle?.close();}
}
