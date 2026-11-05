import {validateArchitecture} from './architecture-schema.js';
// Local-only normalization. No model or network calls and no inferred dependencies.
const objects=x=>x&&typeof x==='object'&&!Array.isArray(x);
const list=(value)=>Array.isArray(value)?value:objects(value)?Object.entries(value).map(([key,v])=>typeof v==='string'?{id:key,name:key,description:v}:objects(v)?{...v,id:v.id||key}:null).filter(Boolean):[];
const str=(v,max=2000)=>typeof v==='string'?v.slice(0,max):'';
export function analyzeArchitectureJSON(value){
 if(!objects(value))throw Error('The JSON must describe a system or architecture object.');
 const roots=[value,value.architecture,value.systemArchitecture,value.system_architecture,value.design,value.system,value.blueprint,value.project?.architecture].filter(objects);
 for(const root of roots){
  const entries=list(root.nodes||root.components||root.services||root.modules||root.containers);
  if(!entries.length)continue;
  const nodes=[],pending=[],links=[],aliases=new Map(),labelAliases=new Map(),warnings=[];
  const resolve=value=>aliases.get(String(value))||labelAliases.get(String(value));
  function add(entry,index,parent=null,depth=0){
   if(depth>20||nodes.length>=100)throw Error('Architecture exceeds the supported component/depth limit.');
   if(typeof entry==='string')entry={name:entry};if(!objects(entry))return;
   const label=str(entry.label||entry.name||entry.title||entry.id,160);if(!label)return;
   const raw=String(entry.id||entry.key||label),safe=/^[A-Za-z0-9_.:/-]{1,120}$/.test(raw)?raw:'component_'+(nodes.length+1);
   if(nodes.some(n=>n.id===safe))throw Error('Each component needs a unique ID: '+label);
   const type=str(entry.type||entry.kind||entry.layer||'component',40);
   nodes.push({id:safe,label,type,description:str(entry.description||entry.responsibility||entry.purpose),responsibilities:Array.isArray(entry.responsibilities)?entry.responsibilities.filter(x=>typeof x==='string').slice(0,12):[],interfaces:Array.isArray(entry.interfaces)?entry.interfaces.map(x=>typeof x==='string'?x:objects(x)?x.name||x.path||x.id:'').filter(Boolean).slice(0,12):[],dataOwnership:Array.isArray(entry.dataOwnership||entry.owns)?(entry.dataOwnership||entry.owns).filter(x=>typeof x==='string').slice(0,12):[],boundary:str(entry.boundary||'',160),...(entry.designStatus!==undefined?{designStatus:entry.designStatus}:{}),...(entry.rationale!==undefined?{rationale:entry.rationale}:{}),...(entry.parentId||parent?{parentId:entry.parentId||parent}:{}),...(entry.groupId?{groupId:entry.groupId}:{})});
   aliases.set(raw,safe);aliases.set(safe,safe);labelAliases.set(label,labelAliases.has(label)?null:safe);
   const dependencies=entry.dependencies||entry.dependsOn||entry.depends_on||entry.uses||[];
   for(const dep of Array.isArray(dependencies)?dependencies:[])pending.push({from:safe,to:typeof dep==='string'?dep:dep?.id||dep?.target||dep?.name});
   for(const child of list(entry.components||entry.children||entry.services))add(child,nodes.length,safe,depth+1);
  }
  entries.forEach((n,i)=>add(n,i));
  for(const edge of list(root.edges||root.connections||root.relationships||root.links||root.interactions)){
   if(!objects(edge))continue;pending.push({from:edge.from||edge.source||edge.caller,to:edge.to||edge.target||edge.callee,label:str(edge.label||edge.description,200),type:str(edge.type,80),protocol:str(edge.protocol,80)});
  }
  const seen=new Set();for(const edge of pending){const from=resolve(edge.from),to=resolve(edge.to);if(!from||!to){warnings.push('Unresolved explicit connection: '+String(edge.from)+' → '+String(edge.to));continue;}const key=JSON.stringify([from,to,edge.label||'',edge.type||'',edge.protocol||'']);if(from===to||seen.has(key))continue;seen.add(key);links.push({from,to,label:edge.label||'',...(edge.type?{type:edge.type}:{}),...(edge.protocol?{protocol:edge.protocol}:{})});}
  const boundaries=root.runtime_boundaries||value.runtime_boundaries||{};
  for(const [boundary,members]of Object.entries(boundaries))if(Array.isArray(members))for(const member of members){const node=nodes.find(n=>n.id===resolve(member));if(node)node.boundary=boundary;}
  const apis=Array.isArray(root.api||value.api)?(root.api||value.api):[];
  for(const api of apis){const node=nodes.find(n=>n.id===resolve(api.service||''));if(node&&typeof api.path==='string')node.interfaces.push(str((api.method||'')+' '+api.path,300));}
  for(const entry of entries){if(objects(entry)&&Array.isArray(entry.tables)){const node=nodes.find(n=>n.id===resolve(entry.id||entry.key||entry.name||''));if(node)node.dataOwnership=entry.tables.filter(x=>typeof x==='string').slice(0,12);}}
  const graph=validateArchitecture({nodes,edges:links,groups:root.groups,...Object.fromEntries(['assumptions','designDecisions','designAlternatives'].filter(k=>root[k]!==undefined).map(k=>[k,root[k]]))},'Local architecture analysis');
  graph.nodes=graph.nodes.map(n=>({...n,...nodes.find(x=>x.id===n.id)}));graph.edges=graph.edges.map(e=>({...e}));
  graph.specification={project:root.project||value.project||null,dataModels:root.data_models||value.data_models||null,databaseSchema:root.database_schema||value.database_schema||null,api:apis,dataRules:Array.isArray(root.data_rules||value.data_rules)?(root.data_rules||value.data_rules):[]};
  graph.analysis={method:'local-explicit-declarations',warnings,unresolved:pending.length-links.length,assumptions:[],note:'Components and explicit relationships were normalized locally. No missing relationship was invented; no file was sent to a model.'};
  return graph;
 }
 throw Error('No component declarations found. Supported forms include architecture.components, components, services, modules or nodes, with explicit dependencies/connections. Keep the original file and review its structure; nothing was sent externally.');
}
