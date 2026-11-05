// Candidate analysis/derivation only: never imports production Preview routes or grants execution.
import {
  createHash}
from 'node:crypto';
import {
  readFileSync}
from 'node:fs';
import {
  analyzeReactV2,EVENT_ADAPTER}
from './react-policy.mjs';
import {
  parseCssV2}
from './css-policy.mjs';
import {
  trustedReactParser,PARSER_MANIFEST_DIGEST}
from '../static-react-policy-loader.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function analyzeReactV2Files({
  files,dependencies=[]}
){
  const fail=code=>({
    supported:false,diagnostic:{
      code}
    ,execution:'not_run',approval:'not_granted'}
  );
  if(!Array.isArray(files)||files.length!==2||new Set(files.map(f=>f?.path)).size!==2||files.some(f=>!['src/main.jsx','src/styles.css'].includes(f?.path)||typeof f.content!=='string')||files.reduce((n,f)=>n+Buffer.byteLength(f.content),0)>100000)return fail('file_set_or_size');
  if(!Array.isArray(dependencies)||dependencies.length>2||new Set(dependencies.map(d=>d?.name)).size!==dependencies.length||dependencies.some(d=>!d||!['react','react-dom'].includes(d.name)||d.version!=='19.3.1'||d.ecosystem!=='npm'||Object.keys(d).some(k=>!['name','version','ecosystem'].includes(k))))return fail('dependency_unsupported');
  const js=analyzeReactV2(files.find(f=>f.path==='src/main.jsx').content,await trustedReactParser());
  if(!js.supported)return js;
  const css=parseCssV2(files.find(f=>f.path==='src/styles.css').content);
  if(!css.supported)return {
    ...css,approval:'not_granted'}
  ;
  const transformedFiles=[{
    path:'src/main.jsx',content:js.transformedSource}
  ,{
    path:'src/styles.css',content:css.css}
  ];
  const rows=items=>items.map(f=>({
    path:f.path,sha256:sha(f.content),bytes:Buffer.byteLength(f.content)}
  )).sort((a,b)=>a.path.localeCompare(b.path));
  return {
    supported:true,profile:'react-capability-v2-candidate',originalFiles:rows(files),transformedFiles,originalDigest:sha(JSON.stringify({
      files:rows(files),dependencies}
    )),transformedDigest:sha(JSON.stringify(rows(transformedFiles))),policyDigest:sha(['react-policy.mjs','css-policy.mjs','profile.mjs'].map(p=>readFileSync(new URL(p,import.meta.url),'utf8')).join('\0')),parserDigest:PARSER_MANIFEST_DIGEST,eventAdapterDigest:sha(EVENT_ADAPTER),derivation:['intrinsic_handlers_receive_frozen_scalar_records','css_closed_subset_canonical_serialization'],execution:'not_run',browser:'unverified',approval:'not_granted',limitations:js.limitations}
  ;
}
