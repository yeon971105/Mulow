import {validateCrudSchema,validateCrudValues,CRUD_LIMITS} from './declarative-crud-schema.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const closed=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
export function validateCrudFrameRequest(raw,schema){
 if(!plain(raw)||new TextEncoder().encode(JSON.stringify(raw)).length>CRUD_LIMITS.requestBytes||typeof raw.id!=='string'||!/^\d{1,9}$/.test(raw.id))throw Error('crud_channel_request_invalid');
 if(raw.action==='mutation-status'){
  if(!closed(raw,['id','action','operationId'])||!uuid(raw.operationId))throw Error('crud_channel_request_invalid');
  return {action:raw.action,payload:{operationId:raw.operationId}};
 }
 const collection=schema.collections.find(c=>c.id===raw.collectionId);if(!collection)throw Error('crud_channel_request_invalid');
 if(raw.action==='list'){
  if(!closed(raw,['id','action','collectionId','after'])||!Number.isSafeInteger(raw.after)||raw.after<0)throw Error('crud_channel_request_invalid');
  return {action:'list',payload:{collectionId:collection.id,after:raw.after,limit:CRUD_LIMITS.page}};
 }
 if(raw.action!=='mutate'||!closed(raw,['id','action','operationId','verb','collectionId','recordId','expectedVersion','values'])||!uuid(raw.operationId)||!['create','update','delete'].includes(raw.verb))throw Error('crud_channel_request_invalid');
 if(raw.verb==='create'&&(raw.recordId!==undefined||raw.expectedVersion!==undefined)||raw.verb!=='create'&&(!uuid(raw.recordId)||!Number.isSafeInteger(raw.expectedVersion)||raw.expectedVersion<1)||raw.verb==='delete'&&raw.values!==undefined)throw Error('crud_channel_request_invalid');
 const payload={operationId:raw.operationId,verb:raw.verb,collectionId:collection.id};
 if(raw.verb!=='create'){payload.recordId=raw.recordId;payload.expectedVersion=raw.expectedVersion;}
 if(raw.verb!=='delete')payload.values=validateCrudValues(collection,raw.values);
 return {action:'mutate',payload};
}
const publicErrors=new Set(['crud_version_conflict','crud_operation_conflict','crud_values_invalid','crud_quota_exceeded','crud_durable_quota_exceeded','crud_rate_limited','crud_context_changed','crud_grant_unavailable','crud_grant_stale','crud_mutation_invalid','crud_collection_invalid','crud_page_invalid']);
// This bridge owns a single exact frame/port. Server grants never enter it.
export function createTrustedCrudBridge({window,frame,nonce,schema,isCurrent,request,onStop=()=>{},onReady=()=>{},MessageChannelCtor=globalThis.MessageChannel,now=()=>Date.now()}){
 const canonical=validateCrudSchema(schema);let port=null,closedPort=false,connected=false,initialized=false,inflight=false,generation=0,lastId=0,times=[];
 if(!frame?.contentWindow||typeof nonce!=='string'||!/^[a-f0-9]{32,64}$/.test(nonce))throw Error('crud_frame_invalid');
 const frameWindow=frame.contentWindow;
 function stop(){if(closedPort)return;closedPort=true;generation++;window.removeEventListener('message',ready);try{port?.postMessage({type:'stop'});}catch{}port?.close();onStop();}
 const current=()=>!closedPort&&frame.contentWindow===frameWindow&&isCurrent()===true;
 async function message(event){
  if(!current()){stop();return;}
  const raw=event.data;
  if(!initialized){if(closed(raw,['type'])&&raw.type==='mulow-crud-initialized'){initialized=true;onReady();}return;}
  let parsed;
  try{parsed=validateCrudFrameRequest(raw,canonical);}catch{return;}
  const id=Number(raw.id);if(id<=lastId)return;lastId=id;
  const t=now();times=times.filter(x=>t-x<10000);
  if(inflight||times.length>=20){port.postMessage({id:raw.id,ok:false,error:'crud_channel_busy'});return;}
  times.push(t);inflight=true;const ticket=generation;
  try{const result=await request(parsed.action,parsed.payload);if(ticket!==generation||!current()){stop();return;}port.postMessage({id:raw.id,ok:true,result});}
  catch(e){if(ticket!==generation||!current()){stop();return;}const code=publicErrors.has(e?.message)?e.message:'crud_write_unconfirmed';port.postMessage({id:raw.id,ok:false,error:code});if(['crud_context_changed','crud_grant_unavailable','crud_grant_stale'].includes(code))stop();}
  finally{if(ticket===generation)inflight=false;}
 }
 function ready(event){
  if(!current()){stop();return;}
  if(connected||event.source!==frameWindow||event.origin!=='null'||!closed(event.data,['type','nonce'])||event.data.type!=='mulow-crud-ready'||event.data.nonce!==nonce)return;
  connected=true;window.removeEventListener('message',ready);const channel=new MessageChannelCtor();port=channel.port1;port.onmessage=message;port.start();frameWindow.postMessage({type:'mulow-crud-connect',nonce},'*',[channel.port2]);port.postMessage({type:'init',schema:canonical});
 }
 window.addEventListener('message',ready);
 return {stop,check(){if(!current())stop();return !closedPort;},connected:()=>connected&&!closedPort,initialized:()=>initialized&&!closedPort};
}
