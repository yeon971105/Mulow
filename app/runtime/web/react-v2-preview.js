// Local review is not execution, a test pass, or permission for a broader profile.
export const REACT_V2_PROFILE='react-capability-preview-v2';
const endpoint='/api/react-capability/';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const hashes=['planDigest','sourceDigest','originalInputDigest','transformedInputDigest','outputDigest','policyDigest','parserDigest','eventAdapterDigest','toolchainDigest','compilerDigest','wrapperDigest','serviceDigest'];
const derivations=['intrinsic_handlers_receive_frozen_scalar_records','css_closed_subset_canonical_serialization'];
const fingerprint=c=>JSON.stringify([c.sessionId,c.sourceKind,c.sourceRevision,c.nativeRevision,c.planRunId,c.context,c.blocked,c.available]);
const digest=async x=>{if(!globalThis.crypto?.subtle)throw Error('crypto_unavailable');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)))].map(x=>x.toString(16).padStart(2,'0')).join('');};
function diagnostic(d){return d&&typeof d.code==='string'&&/^[a-z_]{1,80}$/.test(d.code)?{code:d.code,nodeType:typeof d.nodeType==='string'&&/^[A-Za-z]{1,60}$/.test(d.nodeType)?d.nodeType:'',line:Number.isSafeInteger(d.line)&&d.line>0&&d.line<=100000?d.line:null}:null;}
function errorMessage(e){return ({invalid_review:'The review did not match the current source and profile. Nothing ran.',invalid_start:'The capability did not match the exact review. Nothing was opened.',crypto_unavailable:'Secure file hash verification is unavailable. Nothing ran.',not_connected:'Connect the local server before reviewing this source.',react_capability_source_unsupported:'This source is outside the supported two-file browser profile. No preview ran.',react_capability_current_unavailable:'The current source or saved plan could not be confirmed. Nothing ran.',react_capability_policy_changed:'The preview profile changed. Review again before starting.',react_capability_capacity:'The preview review limit was reached. Stop unused previews before reviewing again.',react_capability_stale:'The source or plan changed. Review the current files again.',react_capability_unsettled_work:'A previous operation is unconfirmed. Resolve its recorded status before reviewing.',react_capability_review_unavailable:'This review expired. Review the current source again.'})[e?.message]||'Browser preview is unavailable. No automatic retry, repair, or fallback was performed.';}
async function fileRows(files,cap){
 if(!Array.isArray(files)||files.length!==2)throw Error('invalid_review');
 let total=0;const rows=[];
 for(const [i,f] of files.entries()){
  if(!f||f.path!==['src/main.jsx','src/styles.css'][i]||typeof f.content!=='string'||!hex(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0||new TextEncoder().encode(f.content).length!==f.bytes||(total+=f.bytes)>cap||await digest(f.content)!==f.sha256)throw Error('invalid_review');
  rows.push({path:f.path,sha256:f.sha256,bytes:f.bytes});
 }
 return rows;
}
function bindingMatches(r,c){return r.sessionId===c.sessionId&&r.sourceKind===c.sourceKind&&r.sourceRevision===c.sourceRevision&&r.planRunId===c.planRunId&&r.nativeRevision===c.nativeRevision&&r.profile===REACT_V2_PROFILE;}
export function createReactV2Preview({getContext,request,onChange=()=>{},now=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout}){
 let value={status:'idle'},epoch=0,timer;
 const revoke=s=>{if(s===value){cancel(timer);timer=null;}if(s?.capabilityId&&s.binding?.sessionId)Promise.resolve(request(endpoint+'stop',{sessionId:s.binding.sessionId,capabilityId:s.capabilityId})).catch(()=>{});};
 function state(){if(value.binding&&fingerprint(getContext(value.binding.sourceKind))!==fingerprint(value.binding)){const retryKind=getContext(value.binding.sourceKind).sessionId===value.binding.sessionId?value.binding.sourceKind:null;epoch++;revoke(value);value={status:'stale',retryKind,message:'Source, plan, session or view changed. Review again before starting.'};}return value;}
 async function review(kind='generated'){
  if(!['generated','external'].includes(kind))return false;
  const c=getContext(kind),generation=++epoch;revoke(value);
  if(c.available!==true||c.blocked||!c.sessionId||!hex(c.sourceRevision)||!c.planRunId||(c.nativeRevision!==null&&!hex(c.nativeRevision))){value={status:'unavailable',message:c.blocked||'Confirm the current source and plan before reviewing.'};onChange();return false;}
  value={status:'checking',binding:{...c}};onChange();
  try{
   const r=await request(endpoint+'review',{sessionId:c.sessionId,sourceKind:kind,sourceRevision:c.sourceRevision,planRunId:c.planRunId});state();if(generation!==epoch)return false;
   if(r?.supported===false&&r.status==='unsupported'){if(r.profile!==REACT_V2_PROFILE||r.execution!=='not_run'||r.browser!=='unverified')throw Error('invalid_review');value={status:'unsupported',binding:{...c},message:'This source is outside the supported browser profile. No preview ran and no fallback was started.',diagnostic:diagnostic(r.diagnostic)};onChange();return false;}
   if(!bindingMatches(r,c)||!hashes.every(k=>hex(r[k]))||typeof r.reviewId!=='string'||!/^[-A-Za-z0-9_]{8,160}$/.test(r.reviewId)||r.execution!=='not_run'||r.tests!=='not_run'||r.browser!=='unverified'||JSON.stringify(r.derivation)!==JSON.stringify(derivations)||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=now()||Date.parse(r.expiresAt)>now()+600000)throw Error('invalid_review');
   const original=await fileRows(r.originalFiles,100000),transformed=await fileRows(r.transformedFiles,120000),deps=r.originalDependencies;
   if(!Array.isArray(deps)||deps.length>2||new Set(deps.map(d=>d?.name)).size!==deps.length||deps.some(d=>!d||!['react','react-dom'].includes(d.name)||d.version!=='19.3.1'||d.ecosystem!=='npm'||Object.keys(d).some(k=>!['name','version','ecosystem'].includes(k))))throw Error('invalid_review');
   if(await digest(JSON.stringify({files:original,dependencies:deps}))!==r.originalInputDigest||await digest(JSON.stringify(transformed))!==r.transformedInputDigest)throw Error('invalid_review');
   state();if(generation!==epoch)return false;
   value={status:'review',binding:{...c},review:r,acceptedRisk:false};onChange();return true;
  }catch(e){if(generation===epoch){value={status:'unavailable',message:errorMessage(e),diagnostic:diagnostic(e?.diagnostic)};onChange();}return false;}
 }
 async function start(){
  state();if(value.status!=='review'||!value.acceptedRisk)return false;
  if(Date.parse(value.review.expiresAt)<=now()){value={status:'stale',retryKind:value.binding.sourceKind,message:'Review expired. Review the current files again.'};onChange();return false;}
  const reviewed=value,generation=++epoch;value={...value,status:'starting'};onChange();let r;
  try{
   r=await request(endpoint+'start',{sessionId:reviewed.binding.sessionId,reviewId:reviewed.review.reviewId,outputDigest:reviewed.review.outputDigest,approve:true,acceptBrowserRisk:true});state();if(generation!==epoch){revoke({...reviewed,...r});return false;}
   const url=new URL(r.url,'http://mulow.invalid');
   if(!bindingMatches(r,reviewed.binding)||!hashes.every(k=>r[k]===reviewed.review[k])||JSON.stringify(r.derivation)!==JSON.stringify(reviewed.review.derivation)||typeof r.capabilityId!=='string'||!/^[-A-Za-z0-9_]{8,160}$/.test(r.capabilityId)||typeof r.url!=='string'||!r.url.startsWith(endpoint+'view?')||url.origin!=='http://mulow.invalid'||url.pathname!==endpoint+'view'||url.hash||url.searchParams.size!==2||url.searchParams.getAll('sessionId').length!==1||url.searchParams.get('sessionId')!==reviewed.binding.sessionId||url.searchParams.getAll('ticket').length!==1||url.searchParams.get('ticket')!==r.capabilityId||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=now()||Date.parse(r.expiresAt)>now()+600000)throw Error('invalid_start');
   value={...reviewed,status:'displaying',url:r.url,capabilityId:r.capabilityId,expiresAt:r.expiresAt};timer=schedule(()=>{if(epoch!==generation||value.capabilityId!==r.capabilityId)return;epoch++;revoke(value);value={status:'stale',retryKind:reviewed.binding.sourceKind,message:'Preview expired. State resets to app defaults on the next approved start.'};onChange();},Date.parse(r.expiresAt)-now());timer?.unref?.();onChange();return true;
  }catch(e){if(r?.capabilityId)revoke({...reviewed,...r});if(generation===epoch){value={status:'unavailable',message:errorMessage(e)};onChange();}return false;}
 }
 return {state,review,start,acceptRisk(yes){state();if(value.status==='review'){value={...value,acceptedRisk:yes===true};onChange();}},stop(){epoch++;revoke(value);value={status:'idle'};onChange();}};
}
const limits='<p>Original files stay unchanged. This preview runs a derived browser bundle: event handlers receive frozen scalar records, and CSS is serialized through a restricted parser.</p><p>Temporary storage starts empty; app state starts from its source defaults, which may include demo data. Stop, reload and expiry reset state. No backend, Node, network or project package execution. Compilation is not a browser test. App code can hang its tab; Stop is best effort.</p>';
export function renderReactV2Preview(s,esc,options={}){
 const sourceLabel=options.sourceLabel||(s.binding?.sourceKind==='external'?'Imported source':'Current project source');
 const sourceAction='<button type="button" data-action="session-files">View source</button>';
 const reviewAction='<button type="button" class="preview-primary" data-action="'+(s.retryKind==='external'?'react-v2-external':'react-v2-review')+'">'+(s.status==='idle'?'Review browser preview':'Review again')+'</button>';
 const information='<details class="preview-information"><summary aria-label="Preview information" title="Preview information">ⓘ</summary><div>'+limits+'</div></details>';
 if(s.status==='displaying')return `<section class="static-source-preview react-v2-preview preview-running preview-minimal" data-interactive="true"><div class="preview-compact-controls"><span class="preview-availability is-available" role="status">Available</span><button type="button" data-action="react-v2-stop">Stop</button>${information}</div><iframe title="Reviewed derived React browser preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${esc(s.url)}"></iframe></section>`;
 if(s.status==='idle')return `<section class="preview-minimal preview-stopped"><div class="preview-compact-controls"><button type="button" data-action="work-preview-start" ${options.hasSource===false?'disabled':''}>Start</button>${information}</div><p class="preview-short-status">Unavailable</p>${options.additionalHTML||''}</section>`;
 if(['checking','starting'].includes(s.status))return `<section class="preview-minimal"><div class="preview-compact-controls"><button type="button" data-action="react-v2-stop">Stop</button>${information}</div><p class="preview-short-status" role="status"><span class="work-phase-spinner" aria-hidden="true"></span>Unavailable</p></section>`;


 if(['stale','review','unsupported','unavailable'].includes(s.status)&&s.binding?.sourceKind!=='external'&&s.retryKind!=='external'){
  const unsupported=s.status==='unsupported',error=unsupported||s.status==='unavailable',message=s.status==='review'?'Compiled source is ready to open.':s.status==='stale'?'Preview stopped because the source or session changed. Start opens the current supported source.':s.message||'Preview is unavailable.';
  const technical=s.diagnostic?'<details class="preview-technical"><summary>Details</summary><p>'+esc(s.diagnostic.code)+(s.diagnostic.line?' · line '+esc(s.diagnostic.line):'')+'</p></details>':'';
  return `<section class="preview-minimal preview-stopped"><div class="preview-compact-controls"><button type="button" data-action="work-preview-start" ${unsupported||options.hasSource===false?'disabled':''}>Start</button>${information}</div><p class="preview-short-status" role="${error?'alert':'status'}">${error?'Unavailable':s.status==='review'?'Available':'Unavailable'}</p>${error?'<details class="preview-technical preview-error-details"><summary aria-label="Preview error details" title="Preview error details">ⓘ</summary><p>'+esc(message)+'</p>'+technical+(options.alternativesHTML?'<details class="preview-alternatives"><summary>Other supported previews</summary>'+options.alternativesHTML+'</details>':'')+'</details>':''}</section>`;
 }

 const files=(label,list)=>'<details class="react-review-files"><summary>'+label+'</summary>'+list.map(f=>'<details><summary>'+esc(f.path)+' · '+esc(f.bytes)+' bytes</summary><small>SHA-256 '+esc(f.sha256)+'</small><pre tabindex="0">'+esc(f.content)+'</pre></details>').join('')+'</details>';
 const empty=s.status==='idle'&&options.hasSource===false;
 const titles={idle:empty?'No source to preview yet':'Preview your app',checking:'Preparing your preview',starting:'Opening preview',review:'Ready to review',unsupported:'Preview not supported yet',unavailable:'Preview unavailable',stale:'Review the current source'};
 const messages={idle:empty?'Generate or import source files to get started.':'Review the current source before running a temporary browser preview.',checking:'Checking the source and compiling locally. Nothing is running.',starting:'Opening only the bundle you reviewed.',review:'Original files stay unchanged. The preview uses the derived files shown below.',unsupported:'This app uses a React feature this preview cannot run yet.',stale:s.message,unavailable:s.message};
 const status={idle:'Not running',checking:'Local checks',starting:'Starting',review:'Not running',unsupported:'Not running',unavailable:'Not running',stale:'Stopped'}[s.status]||'Not running';
 const technical=s.diagnostic?'<details class="preview-technical"><summary>Technical details</summary><p>'+esc(s.diagnostic.code==='import_unsupported'?'Unsupported React import':s.diagnostic.code)+(s.diagnostic.nodeType?' · '+esc(s.diagnostic.nodeType):'')+(s.diagnostic.line?' · line '+esc(s.diagnostic.line):'')+'</p></details>':'';
 const provenance=s.review?files('Original source · unchanged',s.review.originalFiles)+files('Derived source · event facade and CSS transformation',s.review.transformedFiles)+'<details class="preview-technical"><summary>Profile and build provenance</summary><p>'+esc(s.review.profile)+'</p>'+hashes.map(k=>'<small>'+esc(k)+': '+esc(s.review[k])+'</small><br>').join('')+'</details>':'';
 let actions='';
 if(s.status==='idle')actions=(empty?'':reviewAction)+sourceAction;
 else if(['checking','starting'].includes(s.status))actions='<button data-action="react-v2-stop">Cancel</button>';
 else if(s.status==='review')actions='<button data-action="react-v2-stop">Back</button><button class="preview-primary" data-action="react-v2-start" '+(s.acceptedRisk?'':'disabled')+'>Run reviewed browser UI</button>';
 else actions='<button data-action="react-v2-stop">Back</button>'+sourceAction+(s.status==='stale'?reviewAction:'');
 return `<section class="preview-review-surface"><div class="preview-review-panel" aria-label="Browser preview"><header class="preview-panel-heading"><div><small>${esc(sourceLabel)}</small><h2>${esc(titles[s.status]||'Browser preview')}</h2></div><span class="preview-panel-status">${esc(status)}</span></header><p class="preview-panel-message" role="${['unsupported','unavailable'].includes(s.status)?'alert':'status'}">${esc(messages[s.status]||'Nothing is running.')}</p>${s.status==='unsupported'?'<p class="preview-panel-note">Nothing ran. Your source is unchanged.</p>':''}${options.additionalHTML&&['idle','unsupported','unavailable','stopped'].includes(s.status)?options.additionalHTML:''}${technical}${s.status==='review'?'<div class="preview-transform-note"><strong>What changes in the preview</strong>'+limits+'</div>':''}${provenance}${s.status==='review'?'<label class="react-preview-risk"><input type="checkbox" data-react-v2-risk '+(s.acceptedRisk?'checked':'')+'>I accept the disclosed transformations, temporary state, possible tab hangs and best-effort Stop.</label>':''}<footer class="preview-panel-actions">${actions}</footer>${['unsupported','unavailable'].includes(s.status)&&options.alternativesHTML?'<details class="preview-alternatives" data-preview-disclosure="alternatives" data-preview-binding="'+esc(options.disclosureKey||'')+'"><summary>Other ways to preview this source</summary>'+options.alternativesHTML+'</details>':''}</div></section>`;
}
