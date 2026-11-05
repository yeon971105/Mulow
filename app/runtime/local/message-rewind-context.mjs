const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
export function createMessageRewindContext({db,owner='local-musepilot-user',latestPlanId=()=>null}){
 db.exec('CREATE TABLE IF NOT EXISTS message_rewind_contexts(operation_id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,target_checkpoint_id TEXT,prefix_run_ids TEXT NOT NULL)');
 const events=id=>db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(id).map(r=>JSON.parse(r.payload));
 function runs(sessionId,before=Number.MAX_SAFE_INTEGER){return db.prepare('SELECT rowid AS ordinal,id,status FROM runs WHERE owner=? AND session_id=? AND rowid<? ORDER BY rowid').all(owner,sessionId,before);}
 function prefix(sessionId,before=Number.MAX_SAFE_INTEGER,depth=0,seen=new Set()){
  if(depth>64)fail('message_rewind_context_ancestry_invalid');
  const boundary=db.prepare(`SELECT r.rowid AS ordinal,c.operation_id,c.id AS boundary_checkpoint_id,x.operation_id AS context_operation_id,x.target_checkpoint_id,x.prefix_run_ids FROM message_checkpoints c JOIN runs r ON r.operation=c.operation_id AND r.owner=c.owner AND r.session_id=c.session_id LEFT JOIN message_rewind_contexts x ON x.operation_id=c.operation_id AND x.owner=c.owner AND x.session_id=c.session_id WHERE c.owner=? AND c.session_id=? AND c.conversation_rewind=1 AND r.rowid<=? ORDER BY r.rowid DESC LIMIT 1`).get(owner,sessionId,before);
  // Saved prefix arrays are audit evidence, not authority: older versions could
  // persist discarded chronology when editing the replacement boundary itself.
  let prior=[];
  if(boundary&&!boundary.context_operation_id)fail('message_rewind_context_ancestry_invalid');
  if(boundary?.context_operation_id&&boundary.target_checkpoint_id){
   if(seen.has(boundary.operation_id))fail('message_rewind_context_ancestry_invalid');
   const ancestor=db.prepare(`SELECT r.rowid AS ordinal FROM message_checkpoints c JOIN runs r ON r.operation=c.operation_id AND r.owner=c.owner AND r.session_id=c.session_id WHERE c.id=? AND c.owner=? AND c.session_id=?`).get(boundary.target_checkpoint_id,owner,sessionId);
   if(!ancestor||ancestor.ordinal>=boundary.ordinal)fail('message_rewind_context_ancestry_invalid');
   const next=new Set(seen);next.add(boundary.operation_id);
   prior=prefix(sessionId,ancestor.ordinal,depth+1,next);
   if(boundary.ordinal<before&&boundary.prefix_run_ids!==JSON.stringify(prior))throw Object.assign(Error('message_rewind_context_contaminated'),{code:'message_rewind_context_contaminated',status:409,recoveryCheckpointId:boundary.boundary_checkpoint_id});
  }else if(boundary?.prefix_run_ids&&boundary.prefix_run_ids!=='[]')fail('message_rewind_context_ancestry_invalid');
  return [...new Set([...prior,...runs(sessionId,before).filter(r=>!boundary||r.ordinal>=boundary.ordinal).map(r=>r.id)])];
 }
 function target(sessionId,id){
  const cp=db.prepare('SELECT * FROM message_checkpoints WHERE id=? AND owner=? AND session_id=?').get(id,owner,sessionId);
  const dispatch=cp&&db.prepare('SELECT rowid AS ordinal,id FROM runs WHERE operation=? AND owner=? AND session_id=?').get(cp.operation_id,owner,sessionId);
  if(!cp||!dispatch)fail('message_rewind_context_target_unavailable');
  const saved=JSON.parse(cp.snapshot),current=latestPlanId(sessionId);
  if(!saved.planRunId)fail('message_rewind_context_plan_unavailable');
  if(saved.planRunId&&saved.planRunId!==current){const row=db.prepare('SELECT id FROM runs WHERE id=? AND owner=? AND session_id=?').get(current,owner,sessionId),plan=row&&events(current).find(e=>e.type==='plan.created');if(plan?.restoreOf?.sourcePlanRunId!==saved.planRunId)fail('message_rewind_context_plan_mismatch');}
  return prefix(sessionId,dispatch.ordinal);
 }
 function messages(sessionId,ids){const allowed=new Set(ids),result=[];for(const run of runs(sessionId)){if(!allowed.has(run.id)||run.status!=='completed')continue;const es=events(run.id),answer=es.find(e=>e.type==='message.answer'&&typeof e.userMessage==='string'&&typeof e.text==='string');if(answer){result.push({userMessage:answer.userMessage.slice(0,6000),answer:answer.text.slice(0,6000)});continue;}const plan=es.find(e=>e.type==='plan.created'&&!e.restoreOf&&!e.revisionOf&&typeof e.assistantMessage==='string'&&typeof e.goal==='string');if(plan)result.push({userMessage:plan.goal.slice(0,6000),answer:plan.assistantMessage.slice(0,1200)});}return result.slice(-6);}
 return {
  context(sessionId,targetCheckpointId){return messages(sessionId,targetCheckpointId?target(sessionId,targetCheckpointId):prefix(sessionId));},
  bind({sessionId,operationId,rewindCheckpointId}){const ids=rewindCheckpointId?target(sessionId,rewindCheckpointId):[];db.prepare('INSERT INTO message_rewind_contexts(operation_id,owner,session_id,target_checkpoint_id,prefix_run_ids) VALUES(?,?,?,?,?)').run(operationId,owner,sessionId,rewindCheckpointId||null,JSON.stringify(ids));}
 };
}
