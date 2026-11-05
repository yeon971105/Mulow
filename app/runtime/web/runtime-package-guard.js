import {safePackageBinding,safePackageCheckpoint,safePackageProgress} from './package-source-evidence.js';
import {safeSourceVerification,repairableStaticReceipt} from './source-verification-receipt.js';
import {safeAdaptiveWorkFields} from './adaptive-work.js';
import {runtimeRouteEventFields} from './runtime-routes.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=()=>{throw Error('Invalid runtime branching recovery evidence');};
export function createRuntimePackageGuard({runId,sessionId,planRunId,planRevision,baseRevision,tasks,sourceBaseAdoption,refinementHandoff,adaptiveStart}){
 const rows=[adaptiveStart],done=new Set(),begun=new Set();let active=null,step=null,route=null,parent=refinementHandoff?.candidateRevision||sourceBaseAdoption?.externalRevision||baseRevision,last=null,lastGlobalStep=null,calls=0,published=false,failed=false;
 return e=>{
  if(e.runId!==runId||e.sessionId&&e.sessionId!==sessionId)fail();const out={...runtimeRouteEventFields(e,rows),...safeAdaptiveWorkFields(e,rows)};
  if(e.type==='task.started'){const task=tasks.find(t=>t.id===e.taskId);if(active||failed||!task||begun.has(task.id)||task.dependencies.some(d=>!done.has(d)))fail();active=task.id;begun.add(active);route=null;last=null;}
  if(e.type==='milestone.arrived'&&(e.taskId!==active||e.fromWorkStepId!==lastGlobalStep||e.parentCandidateRevision!==parent))fail();
  if(e.type==='work.route.started'){if(!active||step||e.taskId!==active||e.parentCandidateRevision!==parent||route&&!route.assessed)fail();route={id:e.decisionId,workStepId:e.plannedWorkStepId,called:false,calls:0,activeInvocation:null,lastInvocation:null,assessed:false,status:null,selected:null};}
  if(e.type==='work.route.assessed'){if(!route||e.decisionId!==route.id||!route.called||route.assessed||e.parentCandidateRevision!==parent)fail();route.assessed=true;route.status=e.route.status;}
  if(e.type==='work.route.selected'){if(!route||!route.assessed||e.decisionId!==route.id||route.selected||e.plannedWorkStepId!==route.workStepId||e.parentCandidateRevision!==parent)fail();route.selected=e;}
  if(e.type==='work.step.started'){if(step||!route?.selected||e.taskId!==active||e.workStepId!==route.workStepId||e.parentCandidateRevision!==parent||e.title!==route.selected.title||e.instruction!==route.selected.instruction)fail();step={id:e.workStepId,checkOnly:route.selected.selectionActor==='source_check',calls:0,receipts:[],verify:false,checked:false,refined:false};}
  if(e.type.startsWith('tool.')&&e.taskId){
   if(e.taskId!==active||e.agentId!==runId+':worker:'+active)fail();
   if(e.routeDecisionId){if(step||!route||e.routeDecisionId!==route.id||route.assessed||e.name!=='model.chat.completions')fail();if(e.type==='tool.started'){if(route.activeInvocation||route.calls>=2||route.calls===0&&e.routeRepair!==undefined||route.calls===1&&(!e.routeRepair||!rows.some(x=>x.type==='model.response'&&x.invocationId===route.lastInvocation)||!rows.some(x=>x.type==='tool.completed'&&x.invocationId===route.lastInvocation))||++calls>6*tasks.length)fail();route.called=true;route.calls++;route.activeInvocation=e.invocationId;route.lastInvocation=e.invocationId;}else if(['tool.completed','tool.failed'].includes(e.type)){if(route.activeInvocation!==e.invocationId)fail();route.activeInvocation=null;}}
   else{
    if(!step||e.workStepId!==step.id)fail();
    if(e.name==='model.chat.completions'&&e.type==='tool.started'){if(step.checkOnly||step.calls!==step.receipts.length||step.calls>=2||step.calls===1&&!repairableStaticReceipt(step.receipts[0].receipt)||++calls>6*tasks.length)fail();step.calls++;step.verify=false;step.checked=false;}
    if(e.name==='source.verify'){if(step.checkOnly?step.calls!==0||step.receipts.length!==0:step.calls!==step.receipts.length+1)fail();if(e.type==='tool.started'){if(step.verify)fail();step.verify=true;}if(e.type==='tool.completed'){if(!step.verify)fail();step.checked=true;}}
   }
  }
  if(e.type==='package.progress'){
   const p=safePackageProgress(e);if(!step||e.workStepId!==step.id||e.taskId!==active||p.parentCandidateRevision!==parent||e.verified!==false||e.execution!=='not_run'||e.tests!=='not_run')fail();
   if(p.phase==='repairing'){if(step.checkOnly||step.calls!==1||step.receipts.length!==1||!repairableStaticReceipt(step.receipts[0].receipt)||p.failedCandidateRevision!==step.receipts[0].receipt.sourceRevision)fail();}
   else{if(step.checkOnly?p.attempt!==0||step.calls!==0||step.receipts.length:step.calls!==p.attempt+1||step.receipts.length!==p.attempt)fail();if(p.phase==='authored')step.authored=p.candidateRevision;else if(step.authored!==p.candidateRevision)fail();const b=safePackageBinding(e.packageBinding,active);if(b.workStepId!==step.id||b.parentCandidateRevision!==parent)fail();}Object.assign(out,p);
  }
  if(e.sourceVerification!==undefined){
   if(!step||e.type!=='validation.completed'||e.taskId!==active||e.workStepId!==step.id||!step.checked||(step.checkOnly?step.receipts.length!==0:step.receipts.length!==step.calls-1)||e.verified!==false||e.execution!=='not_run'||e.tests!=='not_run')fail();
   const receipt=safeSourceVerification(e.sourceVerification,{runId,sessionId,planRunId,planRevision,baseRevision}),binding=safePackageBinding(e.packageBinding,active),checkpoint=safePackageCheckpoint(e.packageCheckpoint,receipt.sourceRevision);
   if(binding.workStepId!==step.id||binding.attempt!==step.receipts.length||binding.parentCandidateRevision!==parent||binding.attempt&&binding.failedCandidateRevision!==step.receipts[0].receipt.sourceRevision)fail();step.receipts.push({receipt,binding,checkpoint});Object.assign(out,{sourceVerification:receipt,packageBinding:binding,packageCheckpoint:checkpoint,verified:false});
  }
  if(e.type==='work.refined'){last=step?.receipts.at(-1);if(!step||step.refined||e.workStepId!==step.id||last?.receipt.status!=='compiled'||!same(last.binding,e.packageBinding)||!same(last.checkpoint,e.packageCheckpoint)||e.next.length)fail();step.refined=true;}
  if(e.type==='work.step.completed'){last=step?.receipts.at(-1);if(!step||!step.refined||last?.receipt.status!=='compiled'||e.workStepId!==step.id||e.candidateRevision!==last.receipt.sourceRevision||!same(last.binding,e.packageBinding))fail();parent=e.candidateRevision;lastGlobalStep=e.workStepId;step=null;Object.assign(out,{candidateRevision:parent,packageBinding:last.binding,meaning:'source_package_compiled',verified:false});}
  if(e.type==='task.completed'){if(!active||e.taskId!==active||step||route?.status!=='milestone_complete'||last?.receipt.status!=='compiled'||!same(last.binding,e.packageBinding)||e.candidateRevision!==parent||e.meaning!=='source_package_compiled')fail();done.add(active);active=null;route=null;Object.assign(out,{candidateRevision:parent,packageBinding:last.binding,meaning:e.meaning,verified:false});}
  if(e.type==='task.failed'){if(!active||e.taskId!==active)fail();active=null;step=null;failed=true;}
  if(e.type==='project.generated'){if(active||failed||step||done.size!==tasks.length||published||e.revision!==parent||!same(e.sourceBaseAdoption||null,sourceBaseAdoption||null)||!same(e.refinementHandoff||null,refinementHandoff||null)||e.strategy!=='static-react-packages-v1'||e.scope!=='static_frontend_only'||e.goalCompletion!=='not_established')fail();published=true;Object.assign(out,{strategy:e.strategy,scope:e.scope,goalCompletion:e.goalCompletion});}
  if(e.type==='run.completed'&&(!published||active||failed||e.meaning!=='source_packages_compiled'||e.browser!=='unverified'||e.goalCompletion!=='not_established'))fail();
  rows.push(e);return out;
 };
}
