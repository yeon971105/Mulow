// Validated receipts exempt terminal unknown rows, never active work or reserves.
const runId=x=>typeof x==='string'&&/^run_[A-Za-z0-9-]{1,128}$/.test(x);
export function acknowledgedRunIds(value){
 const ids=typeof value==='string'?[value]:Array.isArray(value)?value:[];
 return ids.length<=128&&ids.every(runId)&&new Set(ids).size===ids.length?ids:[];
}
export function hasUnsettledAccounting(db,{owner=null,exemption=null,ignoreRunId=null}={}){
 const where=[],args=[];
 if(owner!==null){where.push('owner=?');args.push(owner);}
 if(runId(ignoreRunId)){where.push('id<>?');args.push(ignoreRunId);}
 // Owner-authorized Mac policy: terminal unknown usage remains recorded and counted, without blocking new requests.
 where.push("(status='running' OR reserved>0)");
 return !!db.prepare('SELECT 1 FROM runs WHERE '+where.join(' AND ')+' LIMIT 1').get(...args);
}
