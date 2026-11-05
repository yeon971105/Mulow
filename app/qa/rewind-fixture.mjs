import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {createLocalStore} from '../runtime/local/store.mjs';
import {createProjectOutputService} from '../runtime/local/project-output.mjs';
import {createBundleStore} from '../runtime/backend/project-output/store.mjs';
import {createLinkedRestore} from '../runtime/local/linked-restore.mjs';
import {createPlanDocumentService} from '../runtime/local/plan-document-service.mjs';
import {documentPlanFields} from '../runtime/web/plan-document.js';
import {storedPlanArtifactFields} from '../runtime/web/planning-artifact.js';
import {requiredCapabilityFields} from '../runtime/web/goal-capabilities.js';
import {implementationProfileFields} from '../runtime/web/implementation-profile.js';
import {validatePlan} from '../runtime/backend/orchestrator.mjs';
import {validateStructuredArchitecture} from '../runtime/web/architecture-schema.js';
import {createReactCapabilityPreview} from '../runtime/local/react-capability-preview.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),owner='local-musepilot-user';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/counter-plan-fixture.json',import.meta.url),'utf8')),files=JSON.parse(readFileSync(new URL('./fixtures/counter.json',import.meta.url),'utf8')).files;
export function setup(t){
 const directory=realpathSync(mkdtempSync(path.join(tmpdir(),'mulow-real-source-rewind-'))),store=createLocalStore(directory);t.after(()=>{store.db.close();rmSync(directory,{recursive:true,force:true});});
 const db=store.db,s=randomUUID(),oldId='run_old-plan',newId='run_new-plan',oldBuild='run_old-build',newBuild='run_new-build',p=structuredClone(fixture.design.plan),newPlan={goal:p.goal,tasks:structuredClone(p.tasks),architecture:structuredClone(p.architecture),clarificationQuestions:[],requiredCapabilities:p.requiredCapabilities,sourceRevision:p.sourceRevision};newPlan.tasks[0].instruction+=' Add a changed implementation.';newPlan.architecture.nodes[0].label+=' changed';
 // Rebase the copied plan to this isolated fixture's owned run and local seal.
 p.planArtifactSeal={sourceRunId:oldId,basePlanRunId:null};p.documentDesignOf={...p.documentDesignOf,sourceRunId:oldId};
 db.exec('CREATE TABLE IF NOT EXISTS plan_artifact_lineage_seals(owner TEXT NOT NULL,session_id TEXT NOT NULL,source_run_id TEXT NOT NULL,base_plan_run_id TEXT,digest TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,session_id,source_run_id,digest))');
 const sealed={...documentPlanFields(p),artifact:p.planArtifact,evidence:p.planAnswerEvidence||[],...(p.planSourceEvidence===undefined?{}:{planSourceEvidence:p.planSourceEvidence})};
 db.prepare('INSERT INTO plan_artifact_lineage_seals VALUES(?,?,?,?,?,?)').run(owner,s,oldId,null,p.planArtifactDigest,JSON.stringify(sealed));
 db.exec('CREATE TABLE IF NOT EXISTS plan_approvals(run_id TEXT,session_id TEXT);CREATE TABLE IF NOT EXISTS plan_choices(run_id TEXT,session_id TEXT,choice_id TEXT);CREATE TABLE IF NOT EXISTS project_runtime_operations(owner TEXT,status TEXT)');
 const projects=createProjectOutputService(store),bundle=createBundleStore(path.join(directory,'project-bundles',s));
 function run(id){const at=new Date().toISOString();db.prepare("INSERT INTO runs(id,operation,session_id,owner,model,status,reserved,charged,started_calls,usage_known,created,finished) VALUES(?,?,?,?,?,'completed',0,0,0,1,?,?)").run(id,id,s,owner,'synthetic-fixture',at,at);}
 function plan(id,value){run(id);for(const [i,event] of [{type:'run.started',interactionMode:'plan',conversation:true},{type:'plan.created',interactionMode:'plan',...value},{type:'run.completed',meaning:'plan_ready_for_approval'}].entries()){const e={...event,runId:id,sessionId:s,id:id+':'+(i+1),sequence:i+1,time:new Date().toISOString()};db.prepare('INSERT INTO events VALUES(?,?,?)').run(id,i+1,JSON.stringify(e));}}
 function source(build,planId,planValue,changed){run(build);const prior=bundle.inspect(),planRevision=hash({planRunId:planId,planChoice:null,tasks:planValue.tasks,architecture:planValue.architecture||null,goal:planValue.goal,sourceRevision:planValue.sourceRevision||null,...requiredCapabilityFields(planValue),...implementationProfileFields(planValue),...storedPlanArtifactFields(planValue)}),proposal={format:'musepilot-project',version:1,baseRevision:prior.revision,complete:true,files:files.map(f=>({path:f.path,content:changed&&f.path==='src/main.jsx'?f.content.replace('c + 1','c + 2').replace('c+1','c+2').replaceAll('Increment +1','Increment +2').replaceAll('Increment counter by 1','Increment counter by 2')+'\n// Later source version\n':f.content})),entrypoints:[{path:'src/main.jsx',purpose:'Counter UI'}],dependencies:[],verificationIntents:[]};const result=bundle.publish(proposal,{runId:build,planRevision,taskIds:planValue.tasks.map(t=>t.id)},{expectedCurrentHash:prior.currentHash});db.prepare('INSERT INTO project_bundles VALUES(?,?,?,?,?,?)').run(build,s,owner,result.revision,planId,JSON.stringify({planRevision}));return result;}
 plan(oldId,p);const oldSource=source(oldBuild,oldId,p,false);plan(newId,newPlan);const newerSource=source(newBuild,newId,newPlan,true);
 const latestPlanId=()=>db.prepare("SELECT r.id FROM runs r JOIN events e ON e.run_id=r.id WHERE r.owner=? AND r.session_id=? AND json_extract(e.payload,'$.type')='plan.created' ORDER BY r.rowid DESC LIMIT 1").get(owner,s)?.id;
 const docs=createPlanDocumentService({store,owner,readContext:()=>({sourceBinding:{native:projects.currentLineage({sessionId:s,owner})},recipient:{provider:'baseten',model:'synthetic'},blocked:false}),validateDesign:(plan,doc)=>{documentPlanFields(plan);assert.deepEqual(plan.planDocument,doc);},perCallCeiling:()=>1});
 const r=fixture.revision,oldPayload=JSON.parse(r.payload),oldRevision=r.id,newRevision='plandoc_newer',newPayload=structuredClone(oldPayload);newPayload.document.markdown+='\n\nA later saved document edit.';
 for(const [id,payload] of [[oldRevision,oldPayload],[newRevision,newPayload]])db.prepare('INSERT INTO plan_document_revisions VALUES(?,?,?,?,?,?,?,?)').run(id,owner,s,id===oldRevision?null:oldRevision,JSON.stringify(payload),hash(payload.document),hash(payload),Date.now());
 db.prepare('INSERT INTO plan_document_heads VALUES(?,?,?)').run(owner,s,newRevision);db.prepare('INSERT INTO plan_document_designs VALUES(?,?,?,?,?,?)').run(oldId,owner,s,oldRevision,JSON.stringify({...fixture.design,plan:p}),hash(p));
 const linked=createLinkedRestore({store,projects,latestPlanId,canonicalPlan:p=>p,validatePlan,validateArchitecture:validateStructuredArchitecture,validateGoalMetadata:()=>({}),goalTransitions:{blocksRun:()=>false},activeRuns:new Set(),checkDocumentRestore:x=>docs.checkLinkedRestore(x),restoreDocumentDesign:x=>docs.restoreLinkedDesign(x)});
 return {s,p,store,projects,bundle,docs,linked,oldSource,newerSource,oldId,newId,oldBuild,oldRevision,newRevision,input:{sessionId:s,targetRunId:oldBuild,targetRevision:oldSource.revision,targetPlanRunId:oldId,basePlanRunId:newId}};
}
