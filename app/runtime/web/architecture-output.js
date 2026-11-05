import {validateStructuredArchitecture,validateArchitecture,ARCHITECTURE_FORMAT} from './architecture-schema.js';
const recordId=/^[A-Za-z0-9_.:/-]{1,200}$/;
export function diagramFromArtifact(artifact){
 if(typeof artifact?.content!=='string'||new TextEncoder().encode(artifact.content).length>16000)return null;
 let data;try{data=JSON.parse(artifact.content);}catch{}
 if(data?.format===ARCHITECTURE_FORMAT||/(^|\/)architecture\.json$/i.test(artifact.name||artifact.path||'')){
  try{return {diagram:validateStructuredArchitecture(data),derived:false,method:'validated_architecture_json'};}catch{return {error:'Saved diagram failed architecture schema validation. The original artifact is preserved.'};}
 }
 // A narrow deterministic recovery of explicitly written arrow links, not inferred components.
 const matches=[...artifact.content.matchAll(/\bFlowchart:\s*([^\n]+)/gi)];
 if(matches.length!==1)return null;
 const labels=matches[0][1].trim().replace(/\.$/,'').split(/\s*(?:→|->)\s*/);
 if(labels.length<2||labels.length>30||labels.some(x=>!x||x.length>120))return null;
 const unique=[...new Set(labels)],ids=new Map(unique.map((x,i)=>[x,'step'+(i+1)])),edges=[];
 for(let i=1;i<labels.length;i++){const from=ids.get(labels[i-1]),to=ids.get(labels[i]);if(from===to)return null;if(!edges.some(e=>e.from===from&&e.to===to))edges.push({from,to});}
 const graph=validateArchitecture({nodes:unique.map(label=>({id:ids.get(label),label,type:'flow step'})),edges});
 return {diagram:{format:ARCHITECTURE_FORMAT,version:1,kind:'interaction-flow',nodes:graph.nodes,edges:graph.edges},derived:true,method:'explicit_flowchart_arrows'};
}
export function recoverArchitectureOutputs(s){
 s.architectureOutputs||=[];
 for(const artifact of s.artifacts||[]){
  if(!recordId.test(artifact.id||'')||s.architectureOutputs.some(x=>x.artifactId===artifact.id))continue;
  const result=diagramFromArtifact(artifact);if(!result)continue;
  const observed=(s.events||[]).find(e=>e.type==='artifacts.created'&&(e.taskId===artifact.taskId||e.taskId===artifact.taskId?.split(':').at(-1))&&(!artifact.runId||e.runId===artifact.runId));
  const historical=!!artifact.historical||!!s.continuationOf;
  const provenance={origin:historical?'Historical saved artifact':s.liveRun?.mode==='mock'?'Mock provider artifact':'Saved model artifact',sourceArtifactId:artifact.id,runId:artifact.runId||null,taskId:artifact.taskId||null,eventId:observed?.id||null,observedAt:observed?.at||null,derived:!!result.derived,method:result.method||'invalid_architecture_json',historical};
  if(result.error){s.architectureOutputs.push({id:artifact.id+':diagram',artifactId:artifact.id,name:artifact.name,error:result.error,provenance});continue;}
  const kind=result.diagram.kind==='interaction-flow'?'Interaction flow':'Component architecture';
  const source=(result.derived?'Derived interaction flow':'Validated '+kind.toLowerCase())+' · '+artifact.name;
  const graph={...result.diagram,source,provenance};
  s.architectureOutputs.push({id:artifact.id+':diagram',artifactId:artifact.id,name:artifact.name,graph,provenance});
  // Existing user/imported/previous-run structures are never silently replaced.
  if(!s.architecture)s.architecture=graph;
 }
 return s.architectureOutputs;
}
export function selectArchitectureOutput(s,id){
 const output=s.architectureOutputs?.find(x=>x.id===id&&x.graph);if(!output)return false;
 if(s.architecture!==output.graph)s.previousArchitecture=s.architecture;
 s.architecture=output.graph;s.componentSelected=null;return true;
}
export function renderArchitectureOutputs(s,esc){
 const outputs=s.architectureOutputs||[];if(!outputs.length)return '';
 return '<details class="architecture-outputs"><summary>Saved diagrams · '+outputs.filter(x=>x.graph).length+'</summary><div>'+outputs.map(x=>x.error?'<p role="status">'+esc(x.name)+' · '+esc(x.error)+'</p>':'<button data-diagram="'+esc(x.id)+'" aria-pressed="'+(s.architecture?.provenance?.sourceArtifactId===x.artifactId)+'">'+esc(x.graph.kind==='interaction-flow'?'Interaction flow':'Component architecture')+' · '+esc(x.name)+'<small>'+esc(x.provenance.derived?'Derived from explicit artifact arrows':x.provenance.origin)+' · '+esc(x.provenance.runId||'historical')+'</small></button>').join('')+'</div></details>';
}
