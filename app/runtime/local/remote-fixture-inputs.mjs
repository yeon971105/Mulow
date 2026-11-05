import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const normalizeFixtureText=s=>s.replace(/\s+/g,' ').trim();
const fail=()=>{throw Error('remote_fixture_input_mismatch');};
function exact(o,keys){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))fail();}
export function verifyRemoteFixtureInput(fixture,evidence,source){
 if(!fixture||!['reading_queue_pdf_v1','habit_tracker_source_v1'].includes(fixture.fixtureId))fail();
 let descriptor,summary;
 if(fixture.fixtureId==='reading_queue_pdf_v1'){
  exact(evidence,['pdf']);const p=evidence.pdf;exact(p,['name','base64','text']);
  if(p.name!==fixture.documentName||typeof p.base64!=='string'||p.base64.length>80000||!/^[A-Za-z0-9+/]+={0,2}$/.test(p.base64)||typeof p.text!=='string'||Buffer.byteLength(p.text)>100000)fail();
  const bytes=Buffer.from(p.base64,'base64');if(bytes.toString('base64')!==p.base64||bytes.length!==fixture.documentBytes)fail();
  descriptor={fixtureId:fixture.fixtureId,pdfSha256:sha(bytes),textSha256:sha(normalizeFixtureText(p.text))};
  summary={documentName:p.name,bytes:bytes.length,sha256:descriptor.pdfSha256,textSha256:descriptor.textSha256,extraction:'browser_pdfjs_text_verified_against_pinned_fixture'};
 }else{
  exact(evidence,['request']);const r=evidence.request;exact(r,['name','text']);
  if(r.name!==fixture.documentName||typeof r.text!=='string'||Buffer.byteLength(r.text)>10000||!source||!Array.isArray(source.files))fail();
  const files=source.files.map(f=>{if(typeof f.path!=='string'||typeof f.content!=='string')fail();return {path:f.path,sha256:sha(f.content)};}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  descriptor={fixtureId:fixture.fixtureId,files,requestSha256:sha(r.text)};
  summary={documentName:r.name,bytes:Buffer.byteLength(r.text),sha256:descriptor.requestSha256,sourceFiles:files,sourceOrigin:'owned_immutable_external_source'};
 }
 const inputDigest=sha(JSON.stringify(descriptor));
 if(inputDigest!==fixture.inputDigest||JSON.stringify(descriptor)!==JSON.stringify(fixture.descriptor))fail();
 return {fixtureId:fixture.fixtureId,inputDigest,summary};
}
export function publicRemoteFixture(f){return {fixtureId:f.fixtureId,label:f.label,goal:f.goal,inputDigest:f.inputDigest,documentName:f.documentName,documentSha256:f.descriptor?.pdfSha256||f.descriptor?.requestSha256,textSha256:f.descriptor?.textSha256||f.descriptor?.requestSha256||null,maxTasks:6};}
