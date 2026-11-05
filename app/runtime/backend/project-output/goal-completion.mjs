/**
 * Pure completion policy, deliberately NOT wired to orchestration.
 * Requirements must come from an approved, server-owned plan. Never derive them
 * from goal prose, model claims, package compilation, or a client's success flag.
 * verifyReceipt is trusted application code: it authenticates evidence and
 * returns a normalized receipt, or null. It must not echo untrusted candidates.
 * No browser/backend/database verifier is implemented by this module.
 */
export const GOAL_CAPABILITIES=Object.freeze([
 'frontend_compile','frontend_browser_tests','backend_runtime','backend_tests',
 'database_migrations','persistence_tests','integration_tests','security_tests',
 'accessibility_tests','deployment_health','declarative_schema_validation','local_crud_runtime'
]);
const capabilities=new Set(GOAL_CAPABILITIES),hash=/^[a-f0-9]{64}$/;
const scopeKeys=['owner','sessionId','runId','planRunId','planRevision','sourceRevision'];
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const invalid=code=>{throw Object.assign(new Error(code),{code});};
export function validateRequiredCapabilities(value){
 if(!Array.isArray(value)||!value.length||value.length>GOAL_CAPABILITIES.length)invalid('required_capabilities_missing_or_invalid');
 if(value.some(x=>typeof x!=='string'||!capabilities.has(x)))invalid('unknown_required_capability');
 if(new Set(value).size!==value.length)invalid('duplicate_required_capability');
 return [...value];
}
function scope(value){
 if(!object(value)||Object.keys(value).some(k=>!scopeKeys.includes(k)))invalid('invalid_completion_scope');
 for(const k of scopeKeys){const x=value[k];if(typeof x!=='string'||!x.length||x.length>256||/[\u0000-\u001f\u007f]/.test(x))invalid('invalid_completion_scope');}
 if(!/^run_[A-Za-z0-9-]+$/.test(value.runId)||!/^run_[A-Za-z0-9-]+$/.test(value.planRunId)||!hash.test(value.planRevision)||!hash.test(value.sourceRevision))invalid('invalid_completion_scope');
 return Object.fromEntries(scopeKeys.map(k=>[k,value[k]]));
}
function receipt(value,expected){
 if(!object(value)||!capabilities.has(value.capability)||!['passed','failed','unsupported'].includes(value.status))invalid('invalid_verified_receipt');
 if(Object.keys(value).some(k=>!['capability','status','scope','evidenceId','evidenceDigest'].includes(k)))invalid('invalid_verified_receipt');
 const bound=scope(value.scope);if(scopeKeys.some(k=>bound[k]!==expected[k]))invalid('receipt_scope_mismatch');
 if(typeof value.evidenceId!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(value.evidenceId)||!hash.test(value.evidenceDigest||''))invalid('invalid_verified_receipt');
 return {capability:value.capability,status:value.status,scope:bound,evidenceId:value.evidenceId,evidenceDigest:value.evidenceDigest};
}
/** Returns only closed policy metadata; never forwards candidate contents/errors. */
export function evaluateGoalCompletion(input,{verifyReceipt}={}){
 let expected,required;
 try{if(!object(input))invalid('invalid_completion_input');expected=scope(input.scope);required=validateRequiredCapabilities(input.requiredCapabilities);if(!Array.isArray(input.receipts)||input.receipts.length>GOAL_CAPABILITIES.length)invalid('invalid_receipt_list');}
 catch(error){return {status:'blocked',complete:false,code:error.code||'invalid_completion_input'};}
 if(typeof verifyReceipt!=='function')return {status:'blocked',complete:false,code:'receipt_verification_unavailable',requiredCapabilities:required};
 const verified=[],seenCapabilities=new Set(),seenEvidence=new Set();
 try{
  for(const candidate of input.receipts){
   // Never accept truthy booleans, promises, issuer strings, or model self-report.
   let trusted;try{trusted=verifyReceipt(candidate,Object.freeze({...expected}));}catch{invalid('receipt_verification_failed');}
   if(!object(trusted))invalid('receipt_verification_failed');
   const r=receipt(trusted,expected);
   if(seenCapabilities.has(r.capability)||seenEvidence.has(r.evidenceId))invalid('duplicate_verified_receipt');
   seenCapabilities.add(r.capability);seenEvidence.add(r.evidenceId);verified.push(r);
  }
 }catch(error){return {status:'blocked',complete:false,code:error.code||'receipt_verification_failed',requiredCapabilities:required};}
 const byCapability=new Map(verified.map(r=>[r.capability,r]));
 const missing=required.filter(c=>!byCapability.has(c)),failed=required.filter(c=>byCapability.get(c)?.status==='failed'),unsupported=required.filter(c=>byCapability.get(c)?.status==='unsupported');
 const status=unsupported.length?'blocked':failed.length?'failed':missing.length?'incomplete':'complete';
 return {status,complete:status==='complete',code:status==='complete'?'required_capabilities_verified':unsupported.length?'required_capability_unsupported':failed.length?'required_capability_failed':'required_evidence_missing',scope:expected,requiredCapabilities:required,missing,failed,unsupported,verified:verified.map(({capability,status,evidenceId,evidenceDigest})=>({capability,status,evidenceId,evidenceDigest}))};
}
