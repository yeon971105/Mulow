import {randomUUID} from 'node:crypto';

// User-requested goal changes are durable, session-bound intent. They do not
// change a plan, approve work, run code or spend money by themselves.
export function createGoalTransitions(store,{latestPlanId,owner='local-musepilot-user'}={}){
 const db=store.db,runId=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]+$/.test(x),sessionId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x),requestId=x=>typeof x==='string'&&/^goal_[A-Za-z0-9_-]{8,80}$/.test(x);
 const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
 db.exec(`CREATE TABLE IF NOT EXISTS goal_transitions(session_id TEXT PRIMARY KEY,owner TEXT NOT NULL,run_id TEXT NOT NULL,base_plan_id TEXT NOT NULL,source_revision TEXT,state TEXT NOT NULL,claimed_through INTEGER NOT NULL DEFAULT 0,operation_id TEXT,proposal_run_id TEXT,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS goal_transition_requests(seq INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,owner TEXT NOT NULL,run_id TEXT NOT NULL,base_plan_id TEXT NOT NULL,text TEXT NOT NULL,created TEXT NOT NULL);`);
 const group=id=>db.prepare('SELECT * FROM goal_transitions WHERE session_id=? AND owner=?').get(id,owner);
 const rows=g=>db.prepare('SELECT seq,request_id,text,created FROM goal_transition_requests WHERE session_id=? AND owner=? AND run_id=? AND base_plan_id=? ORDER BY seq').all(g.session_id,owner,g.run_id,g.base_plan_id);
 const run=id=>db.prepare('SELECT id,session_id,status,reserved,charged,usage_known,operation FROM runs WHERE id=? AND owner=?').get(id,owner);
 const settled=r=>!!r&&['completed','failed','cancelled'].includes(r.status)&&r.reserved===0&&r.usage_known===1;
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}
 function view(g){if(!g)return null;const requests=rows(g),original=run(g.run_id),planner=g.operation_id?db.prepare('SELECT id,status,reserved,usage_known FROM runs WHERE operation=? AND owner=? AND session_id=?').get(g.operation_id,owner,g.session_id):null;
  return {sessionId:g.session_id,runId:g.run_id,basePlanRunId:g.base_plan_id,sourceRevision:g.source_revision,state:g.state,requests:requests.map(x=>({requestId:x.request_id,text:x.text,created:x.created})),latestRequestId:requests.at(-1)?.request_id||null,claimedThrough:g.claimed_through,operationId:g.operation_id,proposalRunId:g.proposal_run_id,original:{status:original?.status||'unconfirmed',reservedUsd:(original?.reserved??0)/1e9,usageKnown:original?.usage_known===1},planner:planner?{runId:planner.id,status:planner.status,reservedUsd:planner.reserved/1e9,usageKnown:planner.usage_known===1}:null,readyToPlan:g.state==='waiting'&&settled(original)&&latestPlanId(g.session_id)===g.base_plan_id&&!db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()};
 }
 return {
  enqueue(input){return transaction(()=>{
   if(!sessionId(input.sessionId)||!runId(input.runId)||!runId(input.basePlanRunId)||!requestId(input.requestId)||typeof input.text!=='string'||!input.text.trim()||Buffer.byteLength(input.text)>4000)fail('invalid_goal_change_request');
   const prior=db.prepare('SELECT * FROM goal_transition_requests WHERE request_id=?').get(input.requestId);
   if(prior){if(prior.owner!==owner||prior.session_id!==input.sessionId||prior.run_id!==input.runId||prior.base_plan_id!==input.basePlanRunId||prior.text!==input.text.trim())fail('goal_request_identity_conflict');const g=group(input.sessionId);if(!g||g.run_id!==prior.run_id||g.base_plan_id!==prior.base_plan_id)fail('goal_request_closed');return view(g);}
   const r=run(input.runId),existing=group(input.sessionId);if(!r||r.session_id!==input.sessionId||latestPlanId(input.sessionId)!==input.basePlanRunId)fail('goal_change_binding_stale');
   if(existing&&existing.state!=='closed'&&(existing.run_id!==input.runId||existing.base_plan_id!==input.basePlanRunId))fail('another_goal_change_pending');
   if(r.status!=='running'&&(!existing||existing.run_id!==r.id||existing.state==='closed')){
    const latest=db.prepare("SELECT r.id FROM runs r JOIN events e ON e.run_id=r.id AND e.sequence=1 WHERE r.owner=? AND r.session_id=? AND json_extract(e.payload,'$.interactionMode')='agent' ORDER BY r.rowid DESC LIMIT 1").get(owner,input.sessionId);
    if(!['completed','failed','cancelled'].includes(r.status)||latest?.id!==r.id)fail('goal_change_run_not_active');
   }
   const start=db.prepare('SELECT payload FROM events WHERE run_id=? AND sequence=1').get(r.id);let e;try{e=JSON.parse(start.payload);}catch{fail('goal_change_run_unconfirmed');}
   if(e.type!=='run.started'||e.interactionMode!=='agent'||e.planRunId!==input.basePlanRunId)fail('goal_change_run_not_bound');
   const plan=db.prepare("SELECT e.payload FROM events e JOIN runs r ON r.id=e.run_id WHERE r.id=? AND r.session_id=? AND r.owner=? AND r.status='completed' AND json_extract(e.payload,'$.type')='plan.created' LIMIT 1").get(input.basePlanRunId,input.sessionId,owner);let p;try{p=JSON.parse(plan.payload);}catch{fail('goal_change_plan_unconfirmed');}
   if((p.sourceRevision||null)!==(input.sourceRevision||null))fail('goal_change_source_stale');
   if(!existing||existing.state==='closed')db.prepare("INSERT INTO goal_transitions VALUES(?,?,?,?,?,'waiting',0,NULL,NULL,?) ON CONFLICT(session_id) DO UPDATE SET owner=excluded.owner,run_id=excluded.run_id,base_plan_id=excluded.base_plan_id,source_revision=excluded.source_revision,state='waiting',claimed_through=0,operation_id=NULL,proposal_run_id=NULL,updated=excluded.updated").run(input.sessionId,owner,input.runId,input.basePlanRunId,input.sourceRevision||null,new Date().toISOString());
   const g=group(input.sessionId),old=rows(g);if(old.length>=20||Buffer.byteLength(old.map(x=>x.text).join('\n')+'\n'+input.text.trim())>5500)fail('goal_change_queue_limit');
   db.prepare('INSERT INTO goal_transition_requests(request_id,session_id,owner,run_id,base_plan_id,text,created) VALUES(?,?,?,?,?,?,?)').run(input.requestId,input.sessionId,owner,input.runId,input.basePlanRunId,input.text.trim(),new Date().toISOString());
   if(['proposed','needs_attention'].includes(g.state))db.prepare("UPDATE goal_transitions SET state='waiting',proposal_run_id=NULL,updated=? WHERE session_id=? AND owner=?").run(new Date().toISOString(),input.sessionId,owner);
   return view(group(input.sessionId));
  });},
  pendingForRun(id){return !!db.prepare("SELECT 1 FROM goal_transitions WHERE run_id=? AND owner=? AND state='waiting' LIMIT 1").get(id,owner);},
  status(id){if(!sessionId(id))fail('invalid_goal_change_session');return view(group(id));},
  claim(input){return transaction(()=>{const g=group(input.sessionId);if(!g||g.state!=='waiting'||g.run_id!==input.runId||g.base_plan_id!==input.basePlanRunId)fail('goal_change_not_waiting');const list=rows(g),last=list.at(-1);if(!last||last.request_id!==input.latestRequestId)fail('goal_change_superseded');const r=run(g.run_id);if(!settled(r)||latestPlanId(g.session_id)!==g.base_plan_id||db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get())fail('goal_change_boundary_unconfirmed');
   const operationId='goalplan_'+randomUUID().replaceAll('-','');db.prepare("UPDATE goal_transitions SET state='planning',claimed_through=?,operation_id=?,proposal_run_id=NULL,updated=? WHERE session_id=? AND owner=? AND state='waiting'").run(last.seq,operationId,new Date().toISOString(),g.session_id,owner);
   return {sessionId:g.session_id,runId:g.run_id,basePlanRunId:g.base_plan_id,sourceRevision:g.source_revision,operationId,throughRequestId:last.request_id,text:list.map((x,i)=>(i+1)+'. '+x.text).join('\n')};
  });},
  reconcile(input){return transaction(()=>{const g=group(input.sessionId);if(!g||g.state!=='planning'||g.operation_id!==input.operationId)fail('goal_change_not_planning');const p=db.prepare('SELECT id,status,reserved,usage_known FROM runs WHERE operation=? AND owner=? AND session_id=?').get(g.operation_id,owner,g.session_id);if(!p||p.status==='running'||p.reserved!==0||p.usage_known!==1)return view(g);
   const last=rows(g).at(-1),events=db.prepare('SELECT payload FROM events WHERE run_id=? ORDER BY sequence').all(p.id).map(x=>JSON.parse(x.payload)),proposal=events.find(e=>e.type==='plan.proposed'&&e.basePlanRunId===g.base_plan_id),answer=events.some(e=>e.type==='message.answer');
   const next=last&&last.seq>g.claimed_through?'waiting':p.status==='completed'&&answer&&proposal?'proposed':'needs_attention';
   db.prepare('UPDATE goal_transitions SET state=?,proposal_run_id=?,updated=? WHERE session_id=? AND owner=?').run(next,next==='proposed'?p.id:null,new Date().toISOString(),g.session_id,owner);return view(group(g.session_id));
  });},
  permitProposal(session,proposal){const g=group(session);return !g||g.state==='closed'||g.state==='proposed'&&g.proposal_run_id===proposal&&rows(g).at(-1)?.seq===g.claimed_through;},
  blocksRun(session){const g=group(session);return !!g&&g.state!=='closed';},
  cancel(input){return transaction(()=>{const g=group(input.sessionId);if(!g||g.run_id!==input.runId||!['waiting','proposed','needs_attention'].includes(g.state))fail('goal_change_cannot_cancel');if(g.state==='proposed'&&g.proposal_run_id!==input.proposalRunId)fail('goal_change_proposal_mismatch');db.prepare("UPDATE goal_transitions SET state='closed',updated=? WHERE session_id=? AND owner=?").run(new Date().toISOString(),g.session_id,owner);return view(group(g.session_id));});},
  close(session,proposal){const g=group(session);if(g?.state==='proposed'&&g.proposal_run_id===proposal)db.prepare("UPDATE goal_transitions SET state='closed',updated=? WHERE session_id=? AND owner=?").run(new Date().toISOString(),session,owner);},
 };
}
