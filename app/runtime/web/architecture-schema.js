import {validateHierarchy} from './architecture-layout.js';
/** Pure shared diagram schema; labels/edges are data, never executable code. */
export const ARCHITECTURE_FORMAT='musepilot-architecture';
// Optional design metadata describes a proposal or supplied requirement, never live verification.
export const DESIGN_STATUSES=['required','proposed','unspecified'];
export function architectureDesignMetadata(value){
 const out={};for(const key of ['assumptions','designDecisions','designAlternatives'])if(value[key]!==undefined){if(!Array.isArray(value[key])||value[key].length>12||value[key].some(x=>typeof x!=='string'||x.length>1000))throw Error('Invalid architecture design notes.');out[key]=[...value[key]];}return out;
}
export function nodeDesignMetadata(n){const out={};if(n.designStatus!==undefined){if(!DESIGN_STATUSES.includes(n.designStatus))throw Error('Invalid architecture design status.');out.designStatus=n.designStatus;}if(n.rationale!==undefined){if(typeof n.rationale!=='string'||n.rationale.length>2000)throw Error('Invalid component rationale.');out.rationale=n.rationale;}return out;}

export function validateArchitecture(value,source='JSON import'){
 if(!value||!Array.isArray(value.nodes)||!Array.isArray(value.edges))throw Error('Expected JSON with nodes and edges arrays.');
 if(!value.nodes.length||value.nodes.length>100||value.edges.length>300)throw Error('Use 1–100 nodes and at most 300 edges.');
 const ids=new Set(),nodes=value.nodes.map(n=>{if(!n||typeof n.id!=='string'||!/^[A-Za-z0-9_.:/-]{1,120}$/.test(n.id)||ids.has(n.id))throw Error('Each node needs a unique safe ID.');ids.add(n.id);const label=n.label||n.name||n.id;if(typeof label!=='string'||!label.trim()||label.length>160)throw Error('Node labels must be text, up to 160 characters.');return {id:n.id,label,type:typeof n.type==='string'?n.type.slice(0,40):'module',description:typeof n.description==='string'?n.description.slice(0,2000):'',responsibilities:Array.isArray(n.responsibilities)?n.responsibilities.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,300)):[],interfaces:Array.isArray(n.interfaces)?n.interfaces.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,300)):[],dataOwnership:Array.isArray(n.dataOwnership)?n.dataOwnership.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,300)):[],boundary:typeof n.boundary==='string'?n.boundary.slice(0,160):'',...nodeDesignMetadata(n),...(n.parentId?{parentId:n.parentId}:{}),...(n.groupId?{groupId:n.groupId}:{})};});
 const links=new Set(),edges=value.edges.map(e=>{if(!e||typeof e!=='object')throw Error('Invalid architecture edge.');const from=e.from??e.source,to=e.to??e.target;const key=JSON.stringify([from,to,e.label||'',e.type||'',e.protocol||'']);if(!ids.has(from)||!ids.has(to)||from===to||links.has(key))throw Error('Every edge must uniquely connect two existing, different node IDs.');links.add(key);return {from,to,...(typeof e.label==='string'?{label:e.label.slice(0,250)}:{}),...(typeof e.type==='string'?{type:e.type.slice(0,80)}:{}),...(typeof e.protocol==='string'?{protocol:e.protocol.slice(0,80)}:{})};});
 if(value.groups!==undefined&&!Array.isArray(value.groups))throw Error('Architecture groups must be an array.');
 const groups=(value.groups||[]).map(g=>{if(!g||typeof g.id!=='string'||!/^[A-Za-z0-9_.:/-]{1,120}$/.test(g.id))throw Error('Invalid architecture group ID.');return {id:g.id,label:typeof g.label==='string'?g.label.slice(0,160):g.id,...(g.parentId?{parentId:g.parentId}:{})};});if(groups.length>100)throw Error('Too many architecture groups.');validateHierarchy({nodes,groups});return {nodes,edges,...(groups.length?{groups}:{}),...architectureDesignMetadata(value),source,createdAt:Date.now()};
}
export function validateStructuredArchitecture(value){
 if(value?.format!==ARCHITECTURE_FORMAT||value.version!==1||!['components','interaction-flow'].includes(value.kind))throw Error('Expected Mulo architecture format, version 1 and diagram kind.');
 if(!Array.isArray(value.nodes)||value.nodes.some(n=>typeof n?.label!=='string')||!Array.isArray(value.edges)||value.edges.some(e=>typeof e?.from!=='string'||typeof e?.to!=='string'))throw Error('Structured diagrams require explicit labels and from/to links.');
 const graph=validateArchitecture(value);
 // Source/provenance is assigned from actual artifact/run metadata, never model-supplied fields.
 return {format:ARCHITECTURE_FORMAT,version:1,kind:value.kind,nodes:graph.nodes,edges:graph.edges,...(graph.groups?{groups:graph.groups}:{}),...architectureDesignMetadata(graph)};
}
export const ARCHITECTURE_EXAMPLE={format:ARCHITECTURE_FORMAT,version:1,kind:'components',nodes:[{id:'client',label:'Client',type:'interface'},{id:'api',label:'API',type:'service'}],edges:[{from:'client',to:'api'}]};
export const requestsArchitecture=goal=>/\barchitecture\b|\bcomponent\s+(?:diagram|graph)\b|\bsystem\s+design\b|아키텍처|아키텍쳐|시스템\s*(?:구조|설계)|구조도/i.test(goal);

/** Shared reservation predicate; references trigger design review, never automatic transmission. */
export function requiresDesignDraft(input){
 if(input.mode!=='plan')return false;
 const request=[input.goal,input.planningInstruction,input.planContext?.goal].filter(x=>typeof x==='string').join(' ');
 const explicitSoftware=/\b(app|application|software|website|codebase|system)\b|앱|코드|시스템|웹사이트/i.test(request);
 const implementation=/\b(build|create|implement|develop)\b|만들|구현|개발/i.test(request);
 // Outcome phrases alone are ambiguous; require explicit implementation intent.
 const softwareOutcome=/\b(study\s+planner|(?:habit|task)\s+tracker|reading\s+queue|dashboard|(?:browser|web|software)\s+tool)\b|학습\s*플래너|습관\s*추적/i.test(request);
 const concreteStack=/\b(react|frontend|front-end|backend|back-end|node\s*(?:js|http)|http\s+api|task\s+tracker|dashboard)\b|프론트엔드|백엔드/i.test(request);
 return !!input.planningContext||!!input.planContext?.needsDesignDraft||requestsArchitecture(request)||explicitSoftware||(implementation&&(concreteStack||softwareOutcome));
}
