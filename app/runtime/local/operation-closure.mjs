/** A zero-dispatch proof only when this tombstone wins against run reservation. */
export function createOperationClosure({db,owner,now=Date.now}){
 if(typeof owner!=='string'||!owner)throw Error('operation_owner_required');
 db.exec('CREATE TABLE IF NOT EXISTS operation_closures (operation TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,closed_at INTEGER NOT NULL)');
 const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
 const validate=input=>{if(!input||!/^[a-f0-9-]{36}$/.test(input.sessionId||'')||!/^[-a-zA-Z0-9_]{8,100}$/.test(input.operationId||''))fail('invalid_session_or_operation');};
 const read=input=>{
  const run=db.prepare('SELECT id,owner,session_id,status FROM runs WHERE operation=?').get(input.operationId);
  if(run){if(run.owner!==owner||run.session_id!==input.sessionId)fail('operation_binding_mismatch');return {status:'reserved',operationId:input.operationId,sessionId:input.sessionId,runId:run.id,runStatus:run.status};}
  const row=db.prepare('SELECT owner,session_id,closed_at FROM operation_closures WHERE operation=?').get(input.operationId);
  if(row){if(row.owner!==owner||row.session_id!==input.sessionId)fail('operation_binding_mismatch');return {status:'not_dispatched',operationId:input.operationId,sessionId:input.sessionId,closedAt:row.closed_at,barrier:'immutable_operation_closure',startedCalls:0};}
  return {status:'absent_unconfirmed',operationId:input.operationId,sessionId:input.sessionId};
 };
 return {
  status(input){validate(input);return read(input);},
  close(input){validate(input);if(input.confirm!==true)fail('operation_closure_confirmation_required');db.exec('BEGIN IMMEDIATE');try{let result=read(input);if(result.status==='absent_unconfirmed'){db.prepare('INSERT INTO operation_closures(operation,owner,session_id,closed_at) VALUES(?,?,?,?)').run(input.operationId,owner,input.sessionId,now());result=read(input);}db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
 };
}
