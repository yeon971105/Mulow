// Versioned files for MusePilot-owned generated workspaces only. Never arbitrary repositories.
import {mkdirSync,readFileSync,writeFileSync,existsSync,realpathSync,lstatSync,renameSync,readdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const safe=name=>typeof name==='string'&&/^[-A-Za-z0-9_./]{1,180}$/.test(name)&&!name.startsWith('/')&&!name.split('/').some(x=>!x||x==='.'||x==='..')&&!/(^|\/)(\.env|credentials|secrets)(\.|\/|$)/i.test(name);
export function createCheckpoints(root){
 mkdirSync(root,{recursive:true,mode:0o700});const base=realpathSync(root);const journal=path.join(base,'versions');mkdirSync(journal,{mode:0o700,recursive:true});
 const workspace=path.join(base,'files');mkdirSync(workspace,{mode:0o700,recursive:true});
 function verifyPath(name){if(!safe(name))throw Error('unsafe_checkpoint_path');const target=path.join(workspace,name);let current=workspace;for(const part of name.split('/')){current=path.join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('symlink_not_allowed');}return target;}
 function scan(dir=workspace,prefix=''){const entries={};for(const item of readdirSync(dir,{withFileTypes:true})){if(item.isSymbolicLink())throw Error('symlink_not_allowed');const relative=prefix+item.name;if(item.isDirectory())Object.assign(entries,scan(path.join(dir,item.name),relative+'/'));else if(item.isFile()){const content=readFileSync(verifyPath(relative));if(content.length>1000000)throw Error('checkpoint_file_too_large');entries[relative]={content:content.toString('base64'),sha256:hash(content)};}}return entries;}
 function snapshot(label){const files=scan();if(Object.keys(files).length>300)throw Error('checkpoint_too_many_files');const id=randomUUID(),data={id,label,time:new Date().toISOString(),files};writeFileSync(path.join(journal,id+'.json'),JSON.stringify(data),{flag:'wx',mode:0o600});return {id,label,time:data.time,files:Object.keys(files)};}
 function load(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('invalid_checkpoint');const data=JSON.parse(readFileSync(path.join(journal,id+'.json'),'utf8'));for(const [name,file]of Object.entries(data.files)){verifyPath(name);if(hash(Buffer.from(file.content,'base64'))!==file.sha256)throw Error('checkpoint_integrity_failed');}return data;}
 function manifest(files){return Object.fromEntries(Object.entries(files).map(([name,value])=>[name,value.sha256]));}
 return {
  snapshot,
  readFile(name){const file=readFileSync(verifyPath(name));if(file.length>1000000)throw Error('checkpoint_file_too_large');return {path:name,content:file.toString('utf8'),sha256:hash(file)};},
  writeArtifact(name,content){const target=verifyPath(name);if(typeof content!=='string'||Buffer.byteLength(content)>1000000)throw Error('invalid_content');const before=snapshot('Before '+name);mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const tmp=target+'.'+randomUUID()+'.tmp';writeFileSync(tmp,content,{flag:'wx',mode:0o600});renameSync(tmp,target);return {before,after:snapshot('Saved '+name),path:name};},
  preview(id){const saved=load(id),now=scan(),changed=[...new Set([...Object.keys(saved.files),...Object.keys(now)])].filter(p=>saved.files[p]?.sha256!==now[p]?.sha256);return {id,changed,expectedCurrent:manifest(now),costsRefunded:false,externalActionsReversed:false};},
  restore(id,expectedCurrent){const saved=load(id),current=scan();const equal=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());if(!equal(manifest(current),expectedCurrent||{}))throw Error('workspace_changed_review_again');const recovery=snapshot('Before restore '+id);
   const staging=path.join(base,'.restore-'+randomUUID()),backup=path.join(base,'.restore-backup-'+randomUUID());let moved=false,installed=false;
   try{
    mkdirSync(staging,{mode:0o700});
    for(const [name,file]of Object.entries(saved.files)){verifyPath(name);const dest=path.join(staging,name);mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});writeFileSync(dest,Buffer.from(file.content,'base64'),{flag:'wx',mode:0o600});}
    if(!equal(manifest(scan()),expectedCurrent||{}))throw Error('workspace_changed_review_again');
    renameSync(workspace,backup);moved=true;renameSync(staging,workspace);installed=true;
    if(!equal(manifest(scan()),manifest(saved.files)))throw Error('restore_verification_failed');
    // Old directory is retained as an additional recovery copy. Never purge user data here.
    return {restored:true,id,recoveryCheckpoint:recovery.id,files:Object.keys(saved.files),costsRefunded:false,externalActionsReversed:false};
   }catch(error){
    if(moved){try{if(installed)renameSync(workspace,path.join(base,'.restore-failed-'+randomUUID()));renameSync(backup,workspace);}catch{error.message='restore_recovery_required';}}
    error.recoveryCheckpoint=recovery.id;throw error;
   }
  }
 };
}
