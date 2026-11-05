import {safeAgentIterationFields} from './agent-iteration.js';
import {validateImplementationProfile} from './implementation-profile.js';
import {validateRequiredCapabilities} from './goal-capabilities.js';
import {MAX_RUN_MODEL_CALLS} from './workflow-limits.js';
// A declared scope selects a supported build profile, never proves Goal completion.
export function resolveAutomaticBuild(plan,{verifierAvailable=false,checkpointAvailable=false,declarativeAvailable=false,runtimeBranching=true}={}){
 safeAgentIterationFields(plan);
 const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
 if(plan?.requiredCapabilities===undefined)fail('build_scope_unclassified');
 let required;try{required=validateRequiredCapabilities(plan.requiredCapabilities);}catch{fail('package_required_capabilities_invalid');}
 if(plan?.implementationProfile!==undefined){try{validateImplementationProfile(plan.implementationProfile);}catch{fail('implementation_profile_invalid');}const allowed=new Set(['declarative_schema_validation','local_crud_runtime','persistence_tests','integration_tests','security_tests','accessibility_tests']);if(!required.includes('declarative_schema_validation')||!required.includes('local_crud_runtime')||required.some(x=>!allowed.has(x)))fail('build_capabilities_unsupported');if(!declarativeAvailable)fail('crud_authoring_unavailable');if(plan?.tasks?.length!==1||plan.tasks[0].dependencies?.length)fail('crud_single_schema_task_required');return Object.freeze({strategy:'trusted-declarative-crud-v1',scope:'local_single_user_declarative_schema',goalCompletion:'not_established',maxModelCalls:1,maxRepairsPerPackage:0,packageCount:1,supportedCapabilities:Object.freeze(['declarative_schema_validation']),deferredCapabilities:Object.freeze(required.filter(x=>x!=='declarative_schema_validation'))});}
 const allowed=new Set(['frontend_compile','frontend_browser_tests','accessibility_tests','persistence_tests','integration_tests','security_tests','deployment_health']);
 if(!required.includes('frontend_compile')||required.some(x=>!allowed.has(x)))fail('build_capabilities_unsupported');
 const deferredCapabilities=Object.freeze(required.filter(x=>x!=='frontend_compile'));
 if(!verifierAvailable||!checkpointAvailable)fail('package_runtime_unavailable');
 const count=plan?.tasks?.length;if(!Number.isInteger(count)||count<1||count>Math.floor(MAX_RUN_MODEL_CALLS/2))fail('package_count_out_of_bounds');
 return Object.freeze({strategy:'static-react-packages-v1',scope:'static_frontend_only',goalCompletion:'not_established',maxModelCalls:(runtimeBranching&&(plan.documentPlanningContract==='document-design-v1'||plan.agentIteration?.version===1)&&count<=6?6:2)*count,maxRepairsPerPackage:1,packageCount:count,supportedCapabilities:Object.freeze(['frontend_compile']),deferredCapabilities});
}
