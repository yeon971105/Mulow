// Data-only checks for an already approved, isolated Preview. No code or shell is evaluated.
import {isDeepStrictEqual} from 'node:util';

const FILE='musepilot.qa.json', MAX_BYTES=16000, MAX_CHECKS=20, MAX_BODY=4096;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,allowed)=>obj(x)&&Object.keys(x).every(k=>allowed.includes(k));
const name=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(x);
const title=x=>typeof x==='string'&&x.trim().length>0&&x.length<=100&&!/[\x00-\x1f\x7f]/.test(x);
const pointer=x=>typeof x==='string'&&x.length<=160&&(x===''||/^\/(?:[A-Za-z0-9_~/-]+)$/.test(x))&&!/~(?![01])/.test(x);
const pathPattern=/^\/api\/(?:[A-Za-z0-9_-]+|\{\{[A-Za-z][A-Za-z0-9_]{0,39}\}\})(?:\/(?:[A-Za-z0-9_-]+|\{\{[A-Za-z][A-Za-z0-9_]{0,39}\}\}))*(?:\?[A-Za-z0-9_=&.-]{1,160})?$/;
const printableJson=x=>{try{return JSON.stringify(x).length<=MAX_BODY;}catch{return false;}};
const bad=()=>{throw Error('invalid_qa_plan');};

export function parseRuntimeQa(files){
 const matches=files.filter(f=>f.path===FILE);if(!matches.length)return {status:'not_configured',checks:[]};
 try{
  if(matches.length!==1||typeof matches[0].content!=='string'||Buffer.byteLength(matches[0].content)>MAX_BYTES)bad();
  const value=JSON.parse(matches[0].content);
  if(!keys(value,['format','version','checks'])||value.format!=='musepilot-http-qa'||value.version!==1||!Array.isArray(value.checks)||!value.checks.length||value.checks.length>MAX_CHECKS)bad();
  const ids=new Set(),captures=new Set(),checks=[];
  for(const x of value.checks){
   if(!keys(x,['id','title','method','path','body','expect','capture'])||!name(x.id)||ids.has(x.id)||!title(x.title)||!['GET','POST'].includes(x.method)||typeof x.path!=='string'||x.path.length>500||!pathPattern.test(x.path))bad();
   ids.add(x.id);for(const [,ref] of x.path.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]{0,39})\}\}/g))if(!captures.has(ref))bad();
   if(x.method==='GET'&&Object.hasOwn(x,'body')||x.method==='POST'&&(!obj(x.body)||!printableJson(x.body)))bad();
   if(!keys(x.expect,['status','json'])||!Number.isInteger(x.expect.status)||x.expect.status<100||x.expect.status>599)bad();
   const assertions=x.expect.json??[];if(!Array.isArray(assertions)||assertions.length>8)bad();
   for(const a of assertions)if(!keys(a,['pointer','equals'])||!pointer(a.pointer)||!Object.hasOwn(a,'equals')||!printableJson(a.equals))bad();
   if(x.capture!==undefined){if(!keys(x.capture,['name','pointer'])||!name(x.capture.name)||!pointer(x.capture.pointer)||captures.has(x.capture.name))bad();captures.add(x.capture.name);}
   checks.push({id:x.id,title:x.title,method:x.method,path:x.path,...(x.method==='POST'?{body:x.body}:{}),expect:{status:x.expect.status,json:assertions},...(x.capture?{capture:x.capture}:{})});
  }
  return {status:'ready',format:value.format,version:1,checks};
 }catch{return {status:'invalid',checks:[],error:'invalid_qa_plan'};}
}

function readPointer(value,p){
 if(p==='')return {found:true,value};let v=value;
 for(const raw of p.slice(1).split('/')){const k=raw.replaceAll('~1','/').replaceAll('~0','~');if(v===null||typeof v!=='object'||!Object.hasOwn(v,k))return {found:false};v=v[k];}
 return {found:true,value:v};
}
const aborted=signal=>{if(signal?.aborted)throw Object.assign(Error('runtime_cancelled'),{code:'runtime_cancelled'});};

export async function runRuntimeQa(plan,{fetch,signal,onCheck=()=>{},now=()=>Date.now()}={}){
 if(plan.status!=='ready')return {status:plan.status==='invalid'?'invalid':'not_run',coverage:'http_api_only',results:[]};
 const values=Object.create(null),results=[];let failed=false;
 for(const check of plan.checks){
  aborted(signal);
  if(failed){results.push({id:check.id,title:check.title,method:check.method,status:'skipped',code:'earlier_check_failed',attempts:0});continue;}
  const result={id:check.id,title:check.title,method:check.method,status:'failed',code:'request_failed',attempts:0},started=now();let response;
  try{
   const path=check.path.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,39})\}\}/g,(_,key)=>{if(!Object.hasOwn(values,key))throw Error('capture_invalid');return values[key];});
   if(!pathPattern.test(path))throw Error('capture_invalid');
   const body=check.method==='POST'?Buffer.from(JSON.stringify(check.body)):null;
   for(let attempt=0;attempt<2;attempt++){
    aborted(signal);result.attempts++;response=await fetch(path,{method:check.method,body,contentType:'application/json',signal});aborted(signal);
    // Only a received 5xx on GET gets one retry; a transport-uncertain request or POST is never repeated.
    if(!(check.method==='GET'&&attempt===0&&response.status>=500&&response.status!==check.expect.status))break;
   }
   result.observedStatus=Number.isInteger(response?.status)?response.status:null;
   if(result.observedStatus!==check.expect.status){result.code='unexpected_status';throw Error('check_failed');}
   let json;if(check.expect.json.length||check.capture){if(!Buffer.isBuffer(response.body)||response.body.length>65536)throw Error('invalid_json');try{json=JSON.parse(response.body.toString('utf8'));}catch{throw Error('invalid_json');}}
   for(const assertion of check.expect.json){const got=readPointer(json,assertion.pointer);if(!got.found||!isDeepStrictEqual(got.value,assertion.equals))throw Error('assertion_failed');}
   if(check.capture){const got=readPointer(json,check.capture.pointer);if(!got.found||typeof got.value!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(got.value))throw Error('capture_invalid');values[check.capture.name]=got.value;}
   result.status='passed';result.code='ok';
  }catch(e){aborted(signal);if(['invalid_json','assertion_failed','capture_invalid'].includes(e.message))result.code=e.message;failed=true;}
  result.durationMs=Math.max(0,Math.min(600000,now()-started));results.push(result);onCheck(result);
 }
 return {status:failed?'failed':'passed',coverage:'http_api_only',results};
}
