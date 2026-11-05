import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateProject,sha256,relativePath,LIMITS} from './contract.mjs';
import {zipEntries} from './zip.mjs';
const MARKER='musepilot-project-bundles-v1\n';
function noLinks(p){let current=path.parse(path.resolve(p)).root;for(const part of path.resolve(p).slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('symlink_not_allowed');}catch(e){if(e.code!=='ENOENT')throw e;}}}
function readRegular(p){noLinks(p);if(!fs.lstatSync(p).isFile())throw Error('regular_file_required');if(fs.statSync(p).size>LIMITS.maxBytes+LIMITS.maxMetadataBytes)throw Error('stored_file_limit');return fs.readFileSync(p);}
export function createBundleStore(root){
 root=path.resolve(root);noLinks(root);
 if(!fs.existsSync(root)){fs.mkdirSync(root,{mode:0o700});fs.writeFileSync(path.join(root,'OWNER'),MARKER,{flag:'wx',mode:0o600});fs.mkdirSync(path.join(root,'revisions'),{mode:0o700});}
 if(readRegular(path.join(root,'OWNER')).toString()!==MARKER)throw Error('unowned_store');
 function inspect(){
  noLinks(root);if(readRegular(path.join(root,'OWNER')).toString()!==MARKER)throw Error('unowned_store');const p=path.join(root,'CURRENT');if(!fs.existsSync(p))return {revision:null,currentHash:null};
  const bytes=readRegular(p),revision=bytes.toString();if(!/^[a-f0-9]{64}$/.test(revision))throw Error('invalid_current');
  return {revision,currentHash:sha256(bytes)};
 }
 function verify(revision){
  if(!/^[a-f0-9]{64}$/.test(revision))throw Error('invalid_revision');
  const dir=path.join(root,'revisions',revision),raw=readRegular(path.join(dir,'manifest.json')),manifest=JSON.parse(raw);
  const {revision:stored,...body}=manifest;if(stored!==revision||sha256(JSON.stringify(body))!==revision)throw Error('manifest_changed');
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>LIMITS.maxFiles)throw Error('invalid_manifest_files');
  for(const f of manifest.files){relativePath(f.path);if(!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isInteger(f.bytes)||f.bytes<0)throw Error('invalid_manifest_file');}
  const seen=[],seenDirs=[];const expectedDirs=new Set();for(const f of manifest.files){const parts=f.path.split('/');parts.pop();while(parts.length){expectedDirs.add(parts.join('/'));parts.pop();}}
  function scan(p,prefix=''){noLinks(p);for(const e of fs.readdirSync(p,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('symlink_not_allowed');const name=prefix+e.name;if(e.isDirectory()){seenDirs.push(name);scan(path.join(p,e.name),name+'/');}else if(e.isFile())seen.push(name);else throw Error('regular_file_required');}}
  scan(path.join(dir,'project'));
  if(JSON.stringify(seenDirs.sort())!==JSON.stringify([...expectedDirs].sort()))throw Error('workspace_changed_review_again');
  if(JSON.stringify(seen.sort())!==JSON.stringify(manifest.files.map(f=>f.path).sort()))throw Error('workspace_changed_review_again');
  const files=manifest.files.map(f=>{const b=readRegular(path.join(dir,'project',f.path));if(sha256(b)!==f.sha256||b.length!==f.bytes)throw Error('workspace_changed_review_again');return [f.path,b];});
  const checked=validateProject({format:'musepilot-project',version:1,baseRevision:manifest.baseRevision,complete:true,files:files.map(([path,b])=>({path,content:b.toString('utf8')})),entrypoints:manifest.entrypoints,dependencies:manifest.dependencies,verificationIntents:manifest.verificationIntents.map(({id,description})=>({id,description}))},manifest.source);
  if(JSON.stringify(checked.manifest)!==JSON.stringify(manifest))throw Error('invalid_manifest_contract');
  return {manifest,files};
 }
 function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
 function assertCurrent(expected,base){const now=inspect();if(now.currentHash!==expected||now.revision!==base)throw Error('stale_revision');if(now.revision)verify(now.revision);}
 return {
  inspect,
  readSnapshot(revision){
   const before=inspect();if(before.revision)verify(before.revision);
   const {manifest,files}=verify(revision);assertCurrent(before.currentHash,before.revision);
   return freeze({revision,manifest,files:files.map(([name,bytes])=>({path:name,content:bytes.toString('utf8'),bytes:bytes.length,sha256:sha256(bytes)})),currentRevision:before.revision,currentHash:before.currentHash});
  },
  rollback(targetRevision,{expectedCurrentHash,expectedCurrentRevision}={}){
   if(expectedCurrentHash===undefined||expectedCurrentRevision===undefined)throw Error('expected_current_hash_required');
   noLinks(root);const lock=path.join(root,'LOCK');let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('store_busy_review_lock');}
   const pointer=path.join(root,'.rollback-pointer-'+randomUUID());let pointerChanged=false;
   try{
    assertCurrent(expectedCurrentHash,expectedCurrentRevision);if(targetRevision===expectedCurrentRevision)throw Error('rollback_already_current');
    verify(targetRevision);fs.writeFileSync(pointer,targetRevision,{flag:'wx',mode:0o600});
    assertCurrent(expectedCurrentHash,expectedCurrentRevision);verify(targetRevision);fs.renameSync(pointer,path.join(root,'CURRENT'));pointerChanged=true;
    return {...inspect(),previousRevision:expectedCurrentRevision,status:'source_pointer_restored',execution:'not_run',tests:'not_run'};
   }catch(error){if(pointerChanged)error.pointerChanged=true;throw error;}finally{try{fs.rmSync(pointer,{force:true});fs.closeSync(fd);fs.unlinkSync(lock);}catch(error){if(pointerChanged)error.pointerChanged=true;throw error;}}
  },
  publish(input,source,{expectedCurrentHash}={}){
   const bundle=validateProject(input,source);if(expectedCurrentHash===undefined)throw Error('expected_current_hash_required');
   noLinks(root);const lock=path.join(root,'LOCK');let fd;
   try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('store_busy_review_lock');}
   const stage=path.join(root,'.stage-'+randomUUID()),pointer=path.join(root,'.pointer-'+randomUUID());
   try{
    assertCurrent(expectedCurrentHash,input.baseRevision);noLinks(path.join(root,'revisions'));
    fs.mkdirSync(stage,{mode:0o700});fs.mkdirSync(path.join(stage,'project'),{mode:0o700});
    for(const file of bundle.files){const dest=path.join(stage,'project',file.path);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,file.content,{flag:'wx',mode:0o600});}
    fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(bundle.manifest),{flag:'wx',mode:0o600});
    assertCurrent(expectedCurrentHash,input.baseRevision);
    const dest=path.join(root,'revisions',bundle.manifest.revision);
    if(fs.existsSync(dest)){const prior=verify(bundle.manifest.revision);if(JSON.stringify(prior.manifest)!==JSON.stringify(bundle.manifest))throw Error('revision_collision');}
    else fs.renameSync(stage,dest);
    verify(bundle.manifest.revision);
    // Only this pointer changes. Old snapshots and unrelated files are never overwritten.
    fs.writeFileSync(pointer,bundle.manifest.revision,{flag:'wx',mode:0o600});
    assertCurrent(expectedCurrentHash,input.baseRevision);fs.renameSync(pointer,path.join(root,'CURRENT'));
    return {...inspect(),status:'generated_unverified',execution:'not_run',tests:'not_run'};
   }finally{fs.rmSync(stage,{recursive:true,force:true});fs.rmSync(pointer,{force:true});fs.closeSync(fd);fs.unlinkSync(lock);}
  },
  exportZip(revision){const {manifest,files}=verify(revision);return zipEntries([['manifest.json',JSON.stringify(manifest,null,2)],...files.map(([p,b])=>['project/'+p,b])]);}
 };
}
