// Explicit source-base authority, separate from generated CURRENT and run receipts.
import {createHash,randomUUID} from 'node:crypto';
import {validateProject} from '../backend/project-output/contract.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=code=>{throw Error(code);};
const frozen=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v);}return v;};
export function createSourceBaseAdoption({db,owner,externalSource,readContext,invalidateApprovals,now=()=>Date.now()}){
 if(!db||typeof owner!=='string'||!owner||!externalSource||typeof readContext!=='function'||typeof invalidateApprovals!=='function')fail('source_adoption_authority_required');
 db.exec(`CREATE TABLE IF NOT EXISTS source_base_adoptions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,binding TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,expires_at INTEGER NOT NULL,accepted INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS source_base_adoption_current(owner TEXT NOT NULL,session_id TEXT NOT NULL,adoption_id TEXT NOT NULL,PRIMARY KEY(owner,session_id));`);
 function context(sessionId,requireIdle=true){
  if(!/^[a-f0-9-]{36}$/.test(sessionId||''))fail('invalid_session');
  const c=readContext({owner,sessionId});
  if(!c||c.then||c.owner!==owner||c.provider!=='baseten'||c.model!=='meta-models/muse-spark-open-1026'||c.sessionId!==sessionId||(requireIdle&&c.idle!==true)||!(c.planRunId===null||/^run_[A-Za-z0-9-]+$/.test(c.planRunId||''))||!(c.planDigest===null||sha(c.planDigest))||(c.planRunId===null)!==(c.planDigest===null)||!(c.nativeRevision===null||sha(c.nativeRevision))||!(c.nativeCurrentHash===null||sha(c.nativeCurrentHash)))fail('source_adoption_context_unavailable');
  return {owner,sessionId,provider:c.provider,model:c.model,planRunId:c.planRunId,planDigest:c.planDigest,nativeRevision:c.nativeRevision,nativeCurrentHash:c.nativeCurrentHash};
 }
 function snapshot(sessionId,revision){
  if(!sha(revision)||externalSource.list({sessionId}).currentRevision!==revision)fail('source_adoption_stale_external');
  const e=externalSource.export({sessionId,revision});
  if(e.revision!==revision||!sha(e.originalSourceDigest)||!e.manifest?.source)fail('source_adoption_invalid_external');
  const v=validateProject(e.source,e.manifest.source);
  if(v.manifest.revision!==revision||JSON.stringify(v.manifest)!==JSON.stringify(e.manifest))fail('source_adoption_changed');
  return {externalRevision:revision,originalSourceDigest:e.originalSourceDigest,sourceDigest:hash(e.source),source:structuredClone(e.source),manifest:structuredClone(e.manifest)};
 }
 function checked(row){if(!row||hash({binding:JSON.parse(row.binding),payload:JSON.parse(row.payload)})!==row.digest)fail('source_adoption_changed');return {binding:JSON.parse(row.binding),payload:JSON.parse(row.payload)};}
 function summary(row){const {binding,payload}=checked(row);return frozen({adoptionId:row.id,digest:row.digest,sessionId:binding.sessionId,provider:binding.provider,model:binding.model,externalRevision:payload.externalRevision,originalSourceDigest:payload.originalSourceDigest,sourceDigest:payload.sourceDigest,fileCount:payload.source.files.length,bytes:payload.source.files.reduce((n,f)=>n+Buffer.byteLength(f.content),0),nativeRevision:binding.nativeRevision,planRunId:binding.planRunId,expiresAt:row.expires_at,provenance:'explicit_reviewed_external_base',execution:'not_run',approval:'fresh_approval_required'});}
 return {
  review({sessionId,externalRevision}){
   const binding=context(sessionId),payload=snapshot(sessionId,externalRevision),id='sourcebase_'+randomUUID(),digest=hash({binding,payload}),expiresAt=now()+300000;
   db.prepare('INSERT INTO source_base_adoptions VALUES(?,?,?,?,?,?,?,0)').run(id,owner,sessionId,JSON.stringify(binding),JSON.stringify(payload),digest,expiresAt);
   return summary(db.prepare('SELECT * FROM source_base_adoptions WHERE id=?').get(id));
  },
  adopt({sessionId,adoptionId,digest,approve,allowModelContext}){
   if(approve!==true||allowModelContext!==true)fail('source_adoption_consent_required');
   db.exec('BEGIN IMMEDIATE');try{
    const row=db.prepare('SELECT * FROM source_base_adoptions WHERE id=? AND owner=? AND session_id=?').get(adoptionId,owner,sessionId);
    if(!row||row.accepted||row.digest!==digest||row.expires_at<=now())fail('source_adoption_review_invalid');
    const {binding,payload}=checked(row);
    if(JSON.stringify(context(sessionId))!==JSON.stringify(binding)||hash(snapshot(sessionId,payload.externalRevision))!==hash(payload))fail('source_adoption_context_changed');
    // Callback must revoke within this same DB transaction, never make remote calls.
    const revoked=invalidateApprovals({owner,sessionId,planRunId:binding.planRunId,adoptionId});
    if(revoked!==true)fail('source_adoption_invalidation_unavailable');
    db.prepare('UPDATE source_base_adoptions SET accepted=1 WHERE id=?').run(adoptionId);
    db.prepare('INSERT INTO source_base_adoption_current VALUES(?,?,?) ON CONFLICT(owner,session_id) DO UPDATE SET adoption_id=excluded.adoption_id').run(owner,sessionId,adoptionId);
    db.exec('COMMIT');return summary(row);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  releaseAfterPublication({sessionId,adoptionId,digest}){
   if(db.isTransaction!==true)fail('source_adoption_transaction_required');
   const row=db.prepare('SELECT a.* FROM source_base_adoptions a JOIN source_base_adoption_current c ON c.adoption_id=a.id AND c.owner=a.owner AND c.session_id=a.session_id WHERE a.id=? AND a.owner=? AND a.session_id=? AND a.accepted=1').get(adoptionId,owner,sessionId);
   checked(row);if(row.digest!==digest)fail('source_adoption_changed');
   if(db.prepare('DELETE FROM source_base_adoption_current WHERE owner=? AND session_id=? AND adoption_id=?').run(owner,sessionId,adoptionId).changes!==1)fail('source_adoption_changed');
  },
  current({sessionId}){if(!/^[a-f0-9-]{36}$/.test(sessionId||''))fail('invalid_session');const row=db.prepare('SELECT a.* FROM source_base_adoptions a JOIN source_base_adoption_current c ON c.adoption_id=a.id AND c.owner=a.owner AND c.session_id=a.session_id WHERE a.owner=? AND a.session_id=? AND a.accepted=1').get(owner,sessionId);if(row)context(sessionId,false);return row?summary(row):null;},
  modelSource({sessionId,adoptionId,expectedNativeRevision,expectedNativeCurrentHash,maxContextBytes}){
   if(!Number.isSafeInteger(maxContextBytes)||maxContextBytes<1||maxContextBytes>1000000)fail('source_adoption_context_budget_required');
   const row=db.prepare('SELECT a.* FROM source_base_adoptions a JOIN source_base_adoption_current c ON c.adoption_id=a.id AND c.owner=a.owner AND c.session_id=a.session_id WHERE a.id=? AND a.owner=? AND a.session_id=? AND a.accepted=1').get(adoptionId,owner,sessionId);
   const {binding,payload}=checked(row),current=context(sessionId,false);
   if(current.provider!==binding.provider||current.model!==binding.model||current.nativeRevision!==binding.nativeRevision||current.nativeCurrentHash!==binding.nativeCurrentHash||binding.nativeRevision!==expectedNativeRevision||binding.nativeCurrentHash!==expectedNativeCurrentHash||hash(snapshot(sessionId,payload.externalRevision))!==hash(payload))fail('source_adoption_context_changed');
   const result={revision:binding.nativeRevision,externalRevision:payload.externalRevision,adoptionId,originalSourceDigest:payload.originalSourceDigest,sourceDigest:payload.sourceDigest,provenance:'explicit_reviewed_external_base',entrypoints:payload.source.entrypoints,dependencies:payload.source.dependencies,files:payload.source.files};
   if(Buffer.byteLength(JSON.stringify(result))>maxContextBytes)fail('source_adoption_context_limit');
   return frozen(result);
  }
 };
}
