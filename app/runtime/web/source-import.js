import {extractPdfText} from './pdf-source.js';
import {analyzeArchitectureJSON} from './architecture-import.js';
const MAX_BYTES=10*1024*1024,MAX_TEXT=1_000_000;
export function analyzeSourceText(text,name='document.txt'){
 if(text.length>MAX_TEXT)throw Error('Text extraction exceeds 1 MB.');
 const clean=text.trim(),reference={graph:null,status:'text reference imported; no validated component graph analyzed',text};
 // Extracted document prose is evidence, not a component/edge declaration.
 // PDF line wrapping can put unrelated sentence fragments beside arrows.
 if(/\.(?:pdf|docx)$/i.test(name))return reference;
 if(clean.startsWith('{')){try{return {graph:analyzeArchitectureJSON(JSON.parse(clean)),status:'analyzed',text};}catch(error){if(/\.json$/i.test(name))return {graph:null,status:'JSON retained; architecture review needed: '+error.message,text};}}
 const diagramLines=clean.split('\n').map(line=>line.trim()).filter(line=>line&&!/^(?:#|\/\/)/.test(line));
 const componentLabel=/^[\p{L}\p{N}_][\p{L}\p{N}_ /()-]{0,63}$/u;
 const connections=diagramLines.map(line=>line.split(/\s+(?:-->|->|→)\s+/).map(x=>x.trim()));
 if(!connections.length||connections.some(parts=>parts.length<2||parts.some(label=>!componentLabel.test(label))))return reference;
 const nodes=[],edges=[],ids=new Map();const add=label=>{label=label.trim().replace(/^['"]|['"]$/g,'');if(!ids.has(label)){const id='n'+ids.size;ids.set(label,id);nodes.push({id,label});}return ids.get(label);};
 for(const parts of connections)for(let i=1;i<parts.length;i++)edges.push({from:add(parts[i-1]),to:add(parts[i])});
 if(nodes.length)return {graph:analyzeArchitectureJSON({nodes,edges}),status:'explicit diagram syntax imported locally; semantics not analyzed',text};
 return {graph:null,status:'text reference imported; no explicit component graph found',text};
}
async function docxText(buffer){
 const data=new DataView(buffer),bytes=new Uint8Array(buffer);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(data.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Invalid DOCX archive.');
 const entries=data.getUint16(end+10,true);if(entries>1000)throw Error('DOCX contains too many entries.');let pos=data.getUint32(end+16,true);
 for(let n=0;n<entries;n++){
  if(pos+46>bytes.length||data.getUint32(pos,true)!==0x02014b50)throw Error('Invalid DOCX directory.');
  const flags=data.getUint16(pos+8,true),method=data.getUint16(pos+10,true),compressed=data.getUint32(pos+20,true),expanded=data.getUint32(pos+24,true),nameLength=data.getUint16(pos+28,true),extra=data.getUint16(pos+30,true),comment=data.getUint16(pos+32,true),offset=data.getUint32(pos+42,true);
  const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+nameLength));pos+=46+nameLength+extra+comment;
  if(name!=='word/document.xml')continue;
  if(flags&1||expanded>2_000_000||compressed>MAX_BYTES||offset+30>bytes.length)throw Error('Encrypted or oversized DOCX is not supported.');
  const start=offset+30+data.getUint16(offset+26,true)+data.getUint16(offset+28,true);if(start+compressed>bytes.length)throw Error('Truncated DOCX.');
  let stream=new Blob([bytes.slice(start,start+compressed)]).stream();if(method===8)stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));else if(method!==0)throw Error('Unsupported DOCX compression.');
  const reader=stream.getReader(),chunks=[];let total=0;while(true){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>2_000_000){await reader.cancel();throw Error('DOCX extraction limit exceeded.');}chunks.push(r.value);}
  const out=new Uint8Array(total);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}const xml=new TextDecoder().decode(out);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML entities are not permitted.');
  return xml.replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
 }
 throw Error('DOCX document content was not found.');
}
export async function inspectSource(file,{pdfParser=extractPdfText}={}){
 if(file.size>MAX_BYTES)throw Error('Choose a file up to 10 MB.');
 const name=file.name||'source',extension=name.split('.').pop().toLowerCase();let text=null;
 if(extension==='pdf'){try{const extracted=await pdfParser(file);const meaningful=extracted.text.replace(/\[Page \d+\]/g,'').trim();if(!meaningful)return {id:'source_'+crypto.randomUUID(),name,type:file.type,size:file.size,graph:null,text:null,status:'PDF has no extractable text; visual OCR may be needed'};const result=analyzeSourceText(extracted.text,name);return {id:'source_'+crypto.randomUUID(),name,type:file.type,size:file.size,...result,status:'PDF text extracted locally · '+extracted.pages+' page(s) · '+result.status};}catch(e){return {id:'source_'+crypto.randomUUID(),name,type:file.type,size:file.size,graph:null,text:null,status:e.name==='PasswordException'?'Password-protected PDF; provide an unlocked local copy':'PDF analysis unavailable: '+e.message};}}
 if(extension==='docx')text=await docxText(await file.arrayBuffer());
 else if(/^(json|txt|md|markdown|yaml|yml|xml|csv|tsv|mermaid|mmd|puml|js|jsx|ts|tsx|mjs|cjs|py|java|sql|html|css|log|rst|toml|ini|sh)$/.test(extension)||file.type?.startsWith('text/'))text=await file.text();
 const result=text!==null?analyzeSourceText(text,name):{graph:null,text:null,status:file.type?.startsWith('image/')?'image retained locally; visual analysis not yet connected':extension==='pdf'?'PDF retained locally; text extraction not yet connected':'file retained locally; parser unavailable for this format'};
 return {id:'source_'+crypto.randomUUID(),name,type:file.type||'application/octet-stream',size:file.size,...result};
}
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('musepilot-sources',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Local file storage unavailable.'));});}
export async function retainSource(id,file){const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Could not retain the file locally.'));});}finally{db.close();}}
export async function readRetainedSource(id){const db=await database();try{return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});}finally{db.close();}}
