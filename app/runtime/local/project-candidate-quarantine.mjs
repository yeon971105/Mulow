import {protectPrivatePathSync,assertPrivatePathSync,protectNewPrivateFileSync} from './private-file-access.mjs';
import path from 'node:path';
import {mkdirSync,lstatSync,readdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,linkSync,unlinkSync,constants,fstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {validateProject,sha256} from '../backend/project-output/contract.mjs';
import {validateCandidateVerification} from '../backend/project-output/verification-receipt.mjs';
const HASH=/^[a-f0-9]{64}$/,RUN=/^run_[A-Za-z0-9-]{1,100}$/,SESSION=/^[a-f0-9-]{36}$/;
const MAX_COUNT=8,MAX_STORAGE=12_000_000,MAX_RECORD=6_500_000;
const fail=code=>{throw Error(code);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
function closedReceipt(r,c,bundle){if(r?.status!=='failed'||r.planRevision!==c.planRevision||r.baseRevision!==c.baseRevision||!['trusted_parser_unavailable','trusted_compiler_unavailable','syntax_rejected','compile_failed','compiler_receipt_invalid'].includes(r.diagnostic?.code))fail('quarantine_receipt_invalid');return validateCandidateVerification(r,{...c,sourceRevision:bundle.manifest.revision},bundle);}
function checkedCandidate(c,context,requireFrozen){
 if(!exact(c,['manifest','files'])||!c.manifest||!Array.isArray(c.files))fail('quarantine_candidate_invalid');
 if(requireFrozen){const seen=new Set();const visit=v=>{if(v&&typeof v==='object'){if(seen.has(v)||!Object.isFrozen(v))fail('quarantine_candidate_not_frozen');seen.add(v);for(const x of Object.values(v))visit(x);}};visit(c);}
 const m=c.manifest;
 const checked=validateProject({format:'musepilot-project',version:1,complete:true,baseRevision:m.baseRevision,files:c.files.map(f=>({path:f.path,content:f.content})),entrypoints:m.entrypoints,dependencies:m.dependencies,verificationIntents:m.verificationIntents?.map(v=>({id:v.id,description:v.description}))},{runId:context.runId,planRevision:context.planRevision,taskIds:context.taskIds});
 if(m.baseRevision!==context.baseRevision||JSON.stringify(checked)!==JSON.stringify(c))fail('quarantine_candidate_integrity');return checked;
}
function directory(p,create=true){const st=lstatSync(p,{throwIfNoEntry:false});if(st){if(st.isSymbolicLink()||!st.isDirectory())fail('quarantine_storage_unsafe');}else if(create)mkdirSync(p,{mode:0o700});else fail('quarantine_not_found');}
function readRegular(p){const st=lstatSync(p);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size>MAX_RECORD)fail('quarantine_storage_unsafe');const fd=openSync(p,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const opened=fstatSync(fd);if(!opened.isFile()||opened.nlink!==1||opened.size>MAX_RECORD||opened.dev!==st.dev||opened.ino!==st.ino||opened.size!==st.size)fail('quarantine_storage_unsafe');const data=readFileSync(fd,'utf8');if(Buffer.byteLength(data)>MAX_RECORD)fail('quarantine_storage_limit');return data;}finally{closeSync(fd);}}
export function createProjectCandidateQuarantine(store){
 const root=path.join(store.directory,'project-candidate-quarantine');directory(store.directory);directory(root);
 function binding(c,active=false){if(!c||typeof c.owner!=='string'||!c.owner||!SESSION.test(c.sessionId||'')||!RUN.test(c.runId||'')||!RUN.test(c.planRunId||'')||!HASH.test(c.planRevision||'')||c.baseRevision!==null&&!HASH.test(c.baseRevision||'')||!Array.isArray(c.taskIds)||!c.taskIds.length)fail('quarantine_binding_invalid');
 const row=store.db.prepare('SELECT status FROM runs WHERE id=? AND owner=? AND session_id=?').get(c.runId,c.owner,c.sessionId),plan=store.db.prepare("SELECT 1 FROM runs WHERE id=? AND owner=? AND session_id=? AND status='completed'").get(c.planRunId,c.owner,c.sessionId);if(!row||!plan||active&&row.status!=='running')fail('quarantine_owned_run_required');return{owner:c.owner,sessionId:c.sessionId,runId:c.runId,planRunId:c.planRunId,planRevision:c.planRevision,baseRevision:c.baseRevision,taskIds:[...c.taskIds]};}
 let privateRootConfirmed=false;
 function location(c,revision,create=true){directory(store.directory,false);directory(root,false);if(process.platform==='win32'&&!privateRootConfirmed){if(create)protectPrivatePathSync(root);else assertPrivatePathSync(root,{mode:0o700});privateRootConfirmed=true;}const ownerDir=path.join(root,sha256(c.owner));directory(ownerDir,create);const dir=path.join(ownerDir,c.sessionId);directory(dir,create);return{dir,file:path.join(dir,revision+'.json')};}
 function verify(data,c,revision){let record;try{record=JSON.parse(data);}catch{fail('quarantine_record_invalid');}if(!exact(record,['version','binding','candidate','receipt','recordDigest'])||record.version!==1||JSON.stringify(record.binding)!==JSON.stringify(c))fail('quarantine_binding_mismatch');const {recordDigest,...payload}=record;if(!HASH.test(recordDigest||'')||sha256(JSON.stringify(payload))!==recordDigest)fail('quarantine_record_integrity');const candidate=checkedCandidate(record.candidate,c,false);if(candidate.manifest.revision!==revision)fail('quarantine_candidate_integrity');if(JSON.stringify(closedReceipt(record.receipt,c,candidate))!==JSON.stringify(record.receipt))fail('quarantine_receipt_invalid');return Object.freeze({candidate,receipt:Object.freeze(record.receipt),candidateRevision:revision,recordDigest,execution:'not_run',published:false});}
 return{
  retain(context,candidate,receipt){const c=binding(context,true),checked=checkedCandidate(candidate,c,true),closed=closedReceipt(receipt,c,checked),revision=checked.manifest.revision,{dir,file}=location(c,revision),payload={version:1,binding:c,candidate:checked,receipt:closed},record={...payload,recordDigest:sha256(JSON.stringify(payload))},data=JSON.stringify(record);if(Buffer.byteLength(data)>MAX_RECORD)fail('quarantine_storage_limit');
   store.db.exec('BEGIN IMMEDIATE');let temp;
   try{binding(context,true);if(lstatSync(file,{throwIfNoEntry:false})){const prior=verify(readRegular(file),c,revision);if(prior.recordDigest!==record.recordDigest)fail('quarantine_immutable_conflict');store.db.exec('COMMIT');return prior;}
    const entries=readdirSync(dir);let bytes=0;for(const name of entries){const st=lstatSync(path.join(dir,name));if(st.isSymbolicLink()||!st.isFile())fail('quarantine_storage_unsafe');bytes+=st.size;}if(entries.length>=MAX_COUNT||bytes+Buffer.byteLength(data)>MAX_STORAGE)fail('quarantine_storage_limit');
    temp=path.join(dir,'.pending-'+randomUUID());const fd=openSync(temp,'wx',0o600);try{protectNewPrivateFileSync(temp);writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}linkSync(temp,file);unlinkSync(temp);temp=null;store.db.exec('COMMIT');return verify(data,c,revision);
   }catch(e){try{store.db.exec('ROLLBACK');}catch{}if(temp)try{unlinkSync(temp);}catch{}throw e;}
  },
  read(context,candidateRevision){const c=binding(context);if(!HASH.test(candidateRevision||''))fail('quarantine_binding_invalid');const {file}=location(c,candidateRevision,false);return verify(readRegular(file),c,candidateRevision);}
 };
}
