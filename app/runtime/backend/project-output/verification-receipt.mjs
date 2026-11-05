import {safeInteractiveEligibility} from '../../web/source-verification-receipt.js';
import {sha256} from './contract.mjs';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const codes=new Set(['entrypoint_unsupported','dependency_unsupported','trusted_parser_unavailable','trusted_compiler_unavailable','syntax_rejected','source_policy_unsupported','compile_failed','compiler_receipt_invalid']);
export function validateCandidateVerification(value,binding,bundle){
 const fail=()=>{throw Object.assign(Error('source_verification_receipt_invalid'),{code:'source_verification_receipt_invalid'});};
 const keys=['owner','sessionId','runId','planRunId','sourceRevision'];
 const inputs=bundle.files.map(({content,...f})=>f),sourceFilesDigest=sha256(JSON.stringify(inputs));
 const dependencies=bundle.manifest.dependencies.map(d=>({...d})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),dependenciesDigest=sha256(JSON.stringify(dependencies));
 const entrypoints=bundle.manifest.entrypoints.map(e=>({...e})).sort((a,b)=>a.path.localeCompare(b.path));
 const sourceDigest=sha256(JSON.stringify({sourceFilesDigest,dependenciesDigest,entrypoints}));
 if(!value||keys.some(k=>value[k]!==binding[k])||value.format!=='mulo-source-verification'||value.version!==1||!['compiled','unsupported','failed'].includes(value.status)||!['reviewed-static-react-v1','static-react-compile-v1'].includes(value.profile)||value.scope!=='complete_assembled_snapshot'||value.execution!=='not_run'||value.tests!=='not_run'||value.browser!=='unverified'||value.approval!=='not_granted'||value.sourceDigest!==sourceDigest||value.sourceFilesDigest!==sourceFilesDigest||value.dependenciesDigest!==dependenciesDigest||JSON.stringify(value.inputs)!==JSON.stringify(inputs)||!['policyDigest','parserDigest','toolchainDigest'].every(k=>hex(value[k])))fail();
 let eligibility=null;if(value.profile==='static-react-compile-v1'){try{eligibility=safeInteractiveEligibility(value.interactiveEligibility);}catch{fail();}}
 const stages=value.status==='compiled'?['drafted','compiled','browser_unverified']:['drafted',value.status];if(JSON.stringify(value.stages)!==JSON.stringify(stages))fail();
 const receipt={format:value.format,version:1,...Object.fromEntries(keys.map(k=>[k,binding[k]])),planRevision:binding.planRevision,baseRevision:binding.baseRevision,sourceDigest,sourceFilesDigest,dependenciesDigest,inputs,profile:value.profile,policyDigest:value.policyDigest,parserDigest:value.parserDigest,toolchainDigest:value.toolchainDigest,scope:value.scope,status:value.status,stages,execution:'not_run',tests:'not_run',browser:'unverified',approval:'not_granted'};
 if(eligibility)receipt.interactiveEligibility=eligibility;
 if(value.status==='compiled'){if(!hex(value.outputDigest)||!Number.isSafeInteger(value.outputBytes)||value.outputBytes<1||value.outputBytes>1600000)fail();Object.assign(receipt,{outputDigest:value.outputDigest,outputBytes:value.outputBytes,dependencyCompleteness:'not_asserted',hostScaffoldSupplied:true,hostReactDependenciesSupplied:true});}
 else{if(!codes.has(value.diagnostic?.code))fail();receipt.diagnostic={code:value.diagnostic.code,...(value.diagnostic.rule==='source_parse_rejected'?{rule:'source_parse_rejected'}:{}),...(Number.isSafeInteger(value.diagnostic.line)&&value.diagnostic.line>=1&&value.diagnostic.line<=100000?{line:value.diagnostic.line}:{})};}
 return receipt;
}
