// These names are schema vocabulary, never arbitrary provider content.
export const PROJECT_FIELD_SETS=Object.freeze({
 project:Object.freeze(['format','version','baseRevision','complete','files','entrypoints','dependencies','verificationIntents']),
 provenance:Object.freeze(['runId','planRevision','taskIds']),file:Object.freeze(['path','content']),
 entrypoint:Object.freeze(['path','purpose']),dependency:Object.freeze(['name','version','ecosystem']),verificationIntent:Object.freeze(['id','description'])
});
export const PROJECT_KNOWN_FIELD_NAMES=Object.freeze([...new Set([...Object.values(PROJECT_FIELD_SETS).flat(),'language','filename','fileName','size','sha256','type','status','command','commands','summary','metadata','project','output','result','payload','response','data','tool_calls','function','arguments','project_name','title','explanation','notes','readme','schema'])]);
const sections=new Set(Object.keys(PROJECT_FIELD_SETS));
const kinds=['array','boolean','null','number','object','other','string'];
export function safeProjectField(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!sections.has(input.section)||!['expected_object','unexpected_fields','missing_fields','unexpected_and_missing_fields'].includes(input.issue))return null;
 const indexed=['file','entrypoint','dependency','verificationIntent'].includes(input.section);
 if(indexed&&(!Number.isSafeInteger(input.index)||input.index<0||input.index>=200))return null;
 const hasUnexpected=['unexpected_fields','unexpected_and_missing_fields'].includes(input.issue);
 const known=Array.isArray(input.knownUnexpected)?[...new Set(input.knownUnexpected.filter(x=>typeof x==='string'&&PROJECT_KNOWN_FIELD_NAMES.includes(x)))].slice(0,30):[];
 const other=Number.isSafeInteger(input.otherUnexpected)&&input.otherUnexpected>=0?Math.min(input.otherUnexpected,1000):0;
 let structure;
 if(input.structure&&typeof input.structure==='object'&&!Array.isArray(input.structure)){
  const allowed=PROJECT_FIELD_SETS[input.section],present=Array.isArray(input.structure.presentExpected)?allowed.filter(k=>input.structure.presentExpected.includes(k)):null;
  const kindCounts=Array.isArray(input.structure.unexpectedKinds)?kinds.flatMap(kind=>{const row=input.structure.unexpectedKinds.find(x=>x?.kind===kind);return Number.isSafeInteger(row?.count)&&row.count>0?[{kind,count:Math.min(row.count,1000)}]:[];}):[];
  const nested=['none','partial','complete'].includes(input.structure.nestedProjectShape)?input.structure.nestedProjectShape:'none';
  const actual=kinds.includes(input.structure.actualKind)?input.structure.actualKind:null;
  structure={...(present?{presentExpected:present,missingExpected:allowed.filter(k=>!present.includes(k))}:{}),...(hasUnexpected?{unexpectedKinds:kindCounts,nestedProjectShape:nested}:{}),...(actual?{actualKind:actual}:{})};
 }
 return {section:input.section,...(indexed?{index:input.index}:{}),issue:input.issue,...(hasUnexpected?{knownUnexpected:known,otherUnexpected:other}:{}),...(structure?{structure}:{})};
}
