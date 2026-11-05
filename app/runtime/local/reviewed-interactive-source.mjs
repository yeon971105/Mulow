// Narrow, audited synthetic fixture capability. NOT a generic untrusted-code runtime.
import {createHash,randomUUID} from 'node:crypto';
export const REVIEWED_TASKLIST_SHA256='2cfd4a0a0c5b21ae9deb8e5ed4391d7da945a225668bf94182b303f68d366586';
export const REVIEWED_ORIGINAL_TASKLIST_SHA256='bc02869fd6b92e8e30f70c70730c913f3bc08a4f4e29a398325dbf44e3ca4334';
export const REVIEWED_STUDY_SHA256='283988327b1f1c258b3751b62ae71d090be8d04f7628f72220908700de2a7bc9';
export const REVIEWED_ORIGINAL_STUDY_SHA256='9e00d1125efad05e26fcf599908581f58ba19ea0f8b67e0c9fa48e1ab5af10b0';
export const REVIEWED_INAPP_STUDY_SHA256='5303b9a6c8fd44da0ccaa8034f27a51b13a5ffcbbf6871d2907e9deff6e41579';
export const REVIEWED_ORIGINAL_INAPP_STUDY_SHA256='cfe29c726c56d1700b27887bc2e1c440956a4484ff2e7382e0d00e70e2a3cca4';
export const REVIEWED_HABIT_DERIVED_SHA256='d75bfaa8891f5cde7c24b32dccb6651d3de741be8dab46aff873aea31a24216a';
export const REVIEWED_PDF_REPAIRED_SHA256='0a59c930512548e9291d0b44bb7cf1f58e24e24e208bf815b227cdb563c45230';
export const REVIEWED_REACT_DERIVED_SHA256='6055a25f60db9d86334d1a557cbf1465710eac1a84969974b76d0b18c6a49c10';
const catalog=new Map([[REVIEWED_REACT_DERIVED_SHA256,'locally_repaired'],[REVIEWED_PDF_REPAIRED_SHA256,'locally_repaired'],[REVIEWED_HABIT_DERIVED_SHA256,'locally_repaired'],[REVIEWED_TASKLIST_SHA256,'locally_repaired'],[REVIEWED_ORIGINAL_TASKLIST_SHA256,'original_unrepaired'],[REVIEWED_STUDY_SHA256,'locally_repaired'],[REVIEWED_ORIGINAL_STUDY_SHA256,'original_unrepaired'],[REVIEWED_INAPP_STUDY_SHA256,'locally_repaired'],[REVIEWED_ORIGINAL_INAPP_STUDY_SHA256,'original_unrepaired']]);
const sha=s=>createHash('sha256').update(s).digest('hex');
const scriptHash=s=>"'sha256-"+createHash('sha256').update(s).digest('base64')+"'";
const attr=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export const VOLATILE_STORAGE_ADAPTER=`(()=>{'use strict';const entries=new Map();const storage=Object.freeze({getItem(key){return entries.get(String(key))??null;},setItem(key,value){key=String(key);value=String(value);const next=new Map(entries);next.set(key,value);let size=0;for(const [k,v] of next)size+=k.length+v.length;if(key.length>128||value.length>65536||size>131072||next.size>32)throw new DOMException('Temporary preview storage quota exceeded','QuotaExceededError');entries.set(key,value);},removeItem(key){entries.delete(String(key));},clear(){entries.clear();},key(index){return [...entries.keys()][index]??null;},get length(){return entries.size;}});Object.defineProperty(window,'localStorage',{value:storage,writable:false,configurable:false});})();`;
// Exported for isolated policy tests; production HTTP always calls pinnedSource first.
export function buildReviewedInteractiveDocument(content){
 const scripts=[...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);if(!scripts.length)throw Error('reviewed_source_script_missing');
 const hashes=[VOLATILE_STORAGE_ADAPTER,...scripts].map(scriptHash).join(' ');
 const common="default-src 'none'; script-src "+hashes+"; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
 const cleaned=content.split(/(<script>[\s\S]*?<\/script>)/g).map(segment=>segment.startsWith('<script>')?segment:segment.replace(/<(?:meta|link|base)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,'')).join('');
 const inner='<meta http-equiv="Content-Security-Policy" content="'+common+"; frame-src 'none'"+'"><script>'+VOLATILE_STORAGE_ADAPTER+'</script>'+cleaned;
 return {html:'<!doctype html><meta charset="utf-8"><title>Reviewed interactive source</title><style>html,body{margin:0;height:100%;background:white}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="Reviewed app · temporary memory only" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="'+attr(inner)+'"></iframe>',headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':common+"; frame-src about:; child-src about:; sandbox allow-scripts; frame-ancestors 'self'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-DNS-Prefetch-Control':'off','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()'}};
}
export function createReviewedInteractiveSource(externalSource,{now=()=>Date.now()}={}){
 const reviews=new Map(),tickets=new Map();
 function prune(){for(const map of [reviews,tickets])for(const [id,r] of map)if(r.expires<=now())map.delete(id);}
 function pinnedSource(sessionId,revision){const current=externalSource.list({sessionId});if(current.currentRevision!==revision)throw Error('interactive_source_stale');const record=externalSource.export({sessionId,revision}),s=record.source;if(s.dependencies.length||s.files.length!==1||s.entrypoints.length!==1||s.entrypoints[0].path!==s.files[0].path||!s.files[0].path.endsWith('.html')||!catalog.has(sha(s.files[0].content)))throw Error('interactive_source_not_reviewed');return {...record,content:s.files[0].content,sourceHash:sha(s.files[0].content),sourceEdition:catalog.get(sha(s.files[0].content))};}
 function metadata(record){return {revision:record.revision,sourceHash:record.sourceHash,sourceEdition:record.sourceEdition,originalSourceDigest:record.originalSourceDigest,derivedDigest:sha(JSON.stringify(buildReviewedInteractiveDocument(record.content))),adapter:'volatile-memory-v1',storage:'temporary_empty_on_each_load',provenance:'reviewed_external_source',execution:'not_started'};}
 return {
  review({sessionId,revision}){prune();if(reviews.size+tickets.size>=128)throw Error('interactive_review_capacity');const record=pinnedSource(sessionId,revision),reviewId='interactive_review_'+randomUUID(),expires=now()+300000,meta=metadata(record);reviews.set(reviewId,{sessionId,revision,expires,...meta});return {reviewId,...meta,expiresAt:new Date(expires).toISOString()};},
  start({sessionId,reviewId,derivedDigest,approve}){prune();if(approve!==true)throw Error('interactive_review_required');const r=reviews.get(reviewId);if(!r||r.sessionId!==sessionId||r.derivedDigest!==derivedDigest)throw Error('interactive_review_mismatch');pinnedSource(sessionId,r.revision);reviews.delete(reviewId);const capabilityId='interactive_'+randomUUID(),expires=now()+600000;tickets.set(capabilityId,{...r,expires,used:false});return {capabilityId,...metadata(pinnedSource(sessionId,r.revision)),expiresAt:new Date(expires).toISOString(),url:'/api/external-source/interactive?'+new URLSearchParams({sessionId,ticket:capabilityId})};},
  view({sessionId,ticket}){prune();const r=tickets.get(ticket);if(!r||r.sessionId!==sessionId||r.used)throw Error('interactive_capability_unavailable');const record=pinnedSource(sessionId,r.revision);if(metadata(record).derivedDigest!==r.derivedDigest)throw Error('interactive_source_stale');r.used=true;return buildReviewedInteractiveDocument(record.content);},
  stop({sessionId,capabilityId}){const r=tickets.get(capabilityId);if(r&&r.sessionId===sessionId)tickets.delete(capabilityId);return {status:'stopped'};}
 };
}
