// Only structural request metadata is persisted. Prompts, headers and keys stay private.
const fields=['version','bodySha256','bodyBytes','model','temperature','responseFormat','reasoningEffort','thinkingMode','outputTokenField','outputLimit','sourceState','sourceRevision'];
export function validateRequestEvidence(v){
 const fail=()=>{throw Error('Invalid request evidence.');};
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==fields.length+(v.continuationSource!==undefined?1:0)||Object.keys(v).some(k=>!fields.includes(k)&&k!=='continuationSource'))fail();
 if(v.version!==1||!/^[a-f0-9]{64}$/.test(v.bodySha256||'')||!Number.isSafeInteger(v.bodyBytes)||v.bodyBytes<1||v.bodyBytes>100000000||typeof v.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(v.model)||v.temperature!==0)fail();
 if(!['json_object','prompt_only'].includes(v.responseFormat)||![null,'low','medium','high','xhigh','max'].includes(v.reasoningEffort)||!['disabled','provider_default'].includes(v.thinkingMode))fail();
 if(v.outputLimit===null?v.outputTokenField!==null:(!Number.isSafeInteger(v.outputLimit)||v.outputLimit<1||v.outputLimit>100000000||!['max_tokens','max_completion_tokens'].includes(v.outputTokenField)))fail();
 if(!['verified','none','unavailable'].includes(v.sourceState)||(v.sourceState==='verified'?!/^[a-f0-9]{64}$/.test(v.sourceRevision||''):v.sourceRevision!==null))fail();
 return {...Object.fromEntries(fields.map(k=>[k,v[k]])),...(v.continuationSource!==undefined?{continuationSource:validateContinuationSource(v.continuationSource)}:{})};
}

export function validateContinuationSource(v,expected={}){const keys=['referenceId','referenceDigest','candidateRevision','recordDigest','sourceFilesDigest','fileCount','sourceBytes','coverage'],hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||!/^continuation_[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.referenceId||'')||!['referenceDigest','candidateRevision','recordDigest','sourceFilesDigest'].every(k=>hex(v[k]))||!Number.isSafeInteger(v.fileCount)||v.fileCount<1||v.fileCount>200||!Number.isSafeInteger(v.sourceBytes)||v.sourceBytes<1||v.sourceBytes>6000000||v.coverage!=='complete_snapshot'||Object.entries(expected).some(([k,x])=>v[k]!==x))throw Error('Invalid retained checkpoint request evidence.');return Object.fromEntries(keys.map(k=>[k,v[k]]));}
