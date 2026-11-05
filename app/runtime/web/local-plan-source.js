import {LOCAL_PLAN_SOURCE_PROFILE,LOCAL_PLAN_SOURCE_LIMITS,LOCAL_PLAN_SOURCE_POLICY,validateLocalPlanFiles} from './local-plan-source-contract.js';
const encoder=new TextEncoder(),sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x),session=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const validDocumentContext=d=>plain(d)&&Object.keys(d).sort().join(',')==='documentDigest,revisionId'&&((d.revisionId===null&&d.documentDigest===null)||/^plandoc_[A-Za-z0-9-]{1,100}$/.test(d.revisionId||'')&&hex(d.documentDigest));
const key=c=>JSON.stringify([c.sessionId,c.model,c.provider,c.providerModel,c.planningInputRevision,c.documentContext,c.requestText,c.blocked,c.recipientRevision??null]);
const prompt=c=>typeof c.requestText==='string'?c.requestText.trim():'';
const validContext=c=>session(c.sessionId)&&c.model==='spark'&&c.provider==='baseten'&&c.providerModel==='meta-models/muse-spark-open-1026'&&typeof c.planningInputRevision==='string'&&c.planningInputRevision.startsWith(c.sessionId+':inputs:')&&/^\d{1,16}$/.test(c.planningInputRevision.slice((c.sessionId+':inputs:').length))&&Number.isSafeInteger(Number(c.planningInputRevision.slice((c.sessionId+':inputs:').length)))&&validDocumentContext(c.documentContext)&&!!prompt(c)&&c.requestText===prompt(c)&&encoder.encode(prompt(c)).length<=LOCAL_PLAN_SOURCE_LIMITS.maxPromptBytes;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const errorText=error=>{
 const code=typeof error?.code==='string'?error.code:typeof error?.message==='string'?error.message:'';
 if(/call_input_limit|local_plan_source_too_large|input_limit|body_limit|request_too_large|payload_too_large/.test(code))return 'The complete selected files and message exceed the allowed request size. Select fewer or smaller files; nothing will be truncated or sent to the model.';
 const messages={local_plan_source_file_count:'Choose between 1 and 200 supported text files. No files were selected for sending.',local_plan_source_sensitive:'Potential credentials, secrets, private configuration, or excluded generated/dependency files detected. The entire selection was rejected; choose a redacted source selection.',local_plan_source_unsupported_type:'An unsupported file type was selected. Choose only the listed source/text types; binary and archive files are not supported.',local_plan_source_path_invalid:'A selected file has an unsupported path. Use relative ASCII paths without traversal or empty segments.',local_plan_source_path_collision:'Selected file paths collide, including case-only or file/folder collisions. Choose an unambiguous selection.',local_plan_source_binary:'A selected file contains binary or unsupported control characters. Choose UTF-8 text source files only.',local_plan_source_utf8_invalid:'A selected file is not valid UTF-8 text. Convert it to UTF-8 before selecting it again.',local_plan_source_file_invalid:'The selected files could not be read completely. Choose the files again.'};
 return messages[code]||'Source review is unavailable or changed. No model call was made. Review again explicitly or exclude these files; there is no automatic retry.';
};
export function createLocalPlanSourceChoice({context,request,onChange=()=>{},now=()=>Date.now()}){
 let state=freeze({phase:'closed'}),epoch=0,files=null,stagedSession=null;
 const set=value=>{state=freeze(value);};
 const current=()=>state.key===key(context());
 function sync(){
  const c=context();
  if(state.phase!=='closed'&&state.phase!=='stale'&&((state.phase==='staging'?stagedSession!==c.sessionId:!current())||state.phase==='review'&&state.receipt.expiresAt<=now())){epoch++;set({...state,phase:'stale',selected:false,error:stagedSession!==c.sessionId?'The session changed. Choose these files again for the current session or exclude them.':'The message, document, input, recipient, or review expiry changed. Review these files again before sending.'});}
  return state;
 }
 function validReceipt(r,c,requestDigest,profileDigest,sourceDigest,manifest){
  return plain(r)&&r.profile===LOCAL_PLAN_SOURCE_PROFILE&&r.profileDigest===profileDigest&&r.sessionId===c.sessionId&&r.provider===c.provider&&r.model===c.providerModel&&r.planningInputRevision===c.planningInputRevision&&JSON.stringify(r.documentContext)===JSON.stringify(c.documentContext)&&r.requestDigest===requestDigest&&/^localsource_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.reviewId||'')&&hex(r.binding)&&r.sourceDigest===sourceDigest&&Array.isArray(r.files)&&JSON.stringify(r.files)===JSON.stringify(manifest)&&r.fileCount===manifest.length&&r.bytes===manifest.reduce((n,f)=>n+f.bytes,0)&&r.coverage==='complete_selected_files'&&r.execution==='not_run'&&r.consent==='required_for_this_plan'&&r.maxModelCalls===1&&Number.isFinite(r.expiresAt)&&r.expiresAt>now()&&r.expiresAt<=now()+LOCAL_PLAN_SOURCE_LIMITS.reviewTtlMs+1000&&Number.isFinite(r.perCallReservationUsd)&&r.perCallReservationUsd>0&&r.reservationUsd===r.perCallReservationUsd&&Number.isSafeInteger(r.inputBytes)&&r.inputBytes>0&&r.inputBytes<=LOCAL_PLAN_SOURCE_LIMITS.maxInputBytes&&Number.isSafeInteger(r.bodyBytes)&&r.bodyBytes>=r.inputBytes&&r.bodyBytes<=LOCAL_PLAN_SOURCE_LIMITS.maxBodyBytes;
 }
 return {
  state:sync,
  canSend(){sync();return state.phase==='closed'||state.phase==='review'&&state.selected===true&&!context().blocked;},
  token(){sync();return state.phase==='review'&&state.selected===true&&!context().blocked?state:null;},
  async stageFiles(selection){
   const c=context(),ticket=++epoch;files=null;stagedSession=c.sessionId;set({phase:'staging',key:key(c),selected:false,files:[]});onChange();
   try{
    if(!session(c.sessionId))throw Error('local_plan_source_file_invalid');
    const chosen=Array.from(selection||[]);if(!chosen.length||chosen.length>LOCAL_PLAN_SOURCE_LIMITS.maxFiles)throw Error('local_plan_source_file_count');
    let total=0;const selected=[];
    for(const file of chosen){
     if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<0)throw Error('local_plan_source_file_invalid');
     total+=file.size;if(total>LOCAL_PLAN_SOURCE_LIMITS.maxSourceBytes)throw Error('local_plan_source_too_large');
     const buffer=await file.arrayBuffer();if(ticket!==epoch||context().sessionId!==stagedSession)return false;
     if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==file.size)throw Error('local_plan_source_file_invalid');
     let content;try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{throw Error('local_plan_source_utf8_invalid');}
     selected.push({path:file.webkitRelativePath||file.name,content});
    }
    const canonical=validateLocalPlanFiles(selected),manifest=await Promise.all(canonical.map(async f=>({path:f.path,bytes:encoder.encode(f.content).length,sha256:await sha(f.content)})));
    if(ticket!==epoch||context().sessionId!==stagedSession)return false;
    files=freeze(canonical);set({phase:'staged',key:key(context()),sessionId:stagedSession,selected:false,files:manifest,fileCount:manifest.length,bytes:total,profile:LOCAL_PLAN_SOURCE_PROFILE});onChange();return true;
   }catch(error){if(ticket===epoch){set({phase:'error',key:key(context()),sessionId:stagedSession,selected:false,files:[],error:errorText(error)});onChange();}return false;}
  },
  async review(){
   sync();const c=structuredClone(context());
   if(!files||stagedSession!==c.sessionId||state.phase==='loading'||state.phase==='staging')return false;
   if(c.blocked||!validContext(c)){set({...state,phase:'error',key:key(c),selected:false,error:c.blocked?'Planning is currently unavailable. No model call was made; wait for the current operation to finish, then review explicitly.':encoder.encode(prompt(c)).length>LOCAL_PLAN_SOURCE_LIMITS.maxPromptBytes?'The exact Plan message exceeds 6,000 UTF-8 bytes. Shorten it yourself before reviewing; nothing is truncated.':typeof c.requestText==='string'&&c.requestText!==prompt(c)?'Remove leading or trailing whitespace from the exact Plan message before reviewing. Nothing was sent.':'Enter a Plan message and choose the supported Muse Spark recipient before reviewing these files.'});onChange();return false;}
   const ticket=++epoch,selectedFiles=files,manifest=state.files;set({...state,phase:'loading',key:key(c),receipt:undefined,requestText:prompt(c),selected:false,error:null});onChange();
   try{
    const [requestDigest,profileDigest,sourceDigest]=await Promise.all([sha(JSON.stringify(prompt(c))),sha(JSON.stringify(LOCAL_PLAN_SOURCE_POLICY)),sha(JSON.stringify({profile:LOCAL_PLAN_SOURCE_PROFILE,files:selectedFiles}))]);
    if(ticket!==epoch||!current())return false;
    const r=await request('/api/local-plan-source/review',{sessionId:c.sessionId,planningInputRevision:c.planningInputRevision,documentContext:structuredClone(c.documentContext),requestText:prompt(c),profile:LOCAL_PLAN_SOURCE_PROFILE,files:structuredClone(selectedFiles)});
    if(ticket!==epoch)return false;
    if(!current()||!validReceipt(r,c,requestDigest,profileDigest,sourceDigest,manifest))throw Error('local_plan_source_review_changed');
    set({...state,phase:'review',receipt:structuredClone(r),selected:false});onChange();return true;
   }catch(error){if(ticket===epoch){set({...state,phase:'error',selected:false,error:errorText(error)});onChange();}return false;}
  },
  select(value){if(sync().phase==='review'&&!context().blocked)set({...state,selected:value===true});onChange();},
  consume(token){if(!token)return {};if(sync()!==token||state.phase!=='review'||state.selected!==true||context().blocked)throw Error('Review the selected files for this exact Plan message again. Nothing was sent to the model.');const r=state.receipt;epoch++;set({phase:'staged',key:key(context()),sessionId:stagedSession,selected:false,files:state.files,fileCount:r.fileCount,bytes:r.bytes,profile:LOCAL_PLAN_SOURCE_PROFILE,retainedSnapshot:true});return {localPlanSource:{reviewId:r.reviewId,binding:r.binding,allowModelContext:true},localPlanningInputRevision:r.planningInputRevision};},
  async close(){const r=state.receipt;epoch++;files=null;stagedSession=null;set({phase:'closed'});onChange();if(r)try{await request('/api/local-plan-source/revoke',{sessionId:r.sessionId,reviewId:r.reviewId,binding:r.binding});}catch{/* Clearing this local choice never dispatches or retries a model request. */}}
 };
}
export function renderLocalPlanSourceChoice(state,esc){
 if(state.phase==='closed')return '';
 const r=state.receipt,manifest=r?.files||state.files||[],reviewable=manifest.length>0&&!['staging','loading'].includes(state.phase),active=state.phase==='review';
 return `<section class="planning-input-review local-plan-source" aria-label="Selected local source for this Plan"><header><strong>Local snapshot</strong><button type="button" data-action="close-local-plan" aria-label="Exclude selected local source">×</button></header>${manifest.length?`<p class="local-source-summary">${manifest.length} selected file${manifest.length===1?'':'s'} · ${(r?.bytes??state.bytes).toLocaleString()} bytes${state.retainedSnapshot?' · Snapshot retained':''}</p>`:''}${state.phase==='staging'?'<p role="status">Reading selected files locally…</p>':state.phase==='loading'?'<p role="status">Checking this exact selection with the local host. No provider call…</p>':''}${state.error?`<p role="status" class="local-source-status">${esc(state.error)}</p>`:''}${r?`<label class="source-context-consent"><input type="checkbox" data-local-plan-consent ${active?'':'disabled'} ${active&&state.selected?'checked':''}><span>Send all ${r.fileCount} selected files, this exact Plan message, the complete existing Plan document (if present), and any known questions to <strong>Muse Spark via Baseten</strong>.<br><strong>1 document-authoring call · Cost ceiling $${esc(String(r.reservationUsd))}.</strong></span></label><small>No design or Build approval. Each message needs a new review.</small>`:'<small>Review locally. Nothing is sent to Muse yet.</small>'}${reviewable?`<button type="button" data-action="review-local-plan">${active?'Review again':'Review for this message'}</button>`:''}<details class="local-source-details"><summary>Source details &amp; privacy</summary>${manifest.length?`<p>Only this immutable selected snapshot, not the whole codebase or live filesystem. No architecture, workflow, or Build starts on selection.</p><details><summary>Exact selected file manifest</summary><ul>${manifest.map(f=>`<li>${esc(f.path)} · ${f.bytes} bytes<br><code>${esc(f.sha256)}</code></li>`).join('')}</ul></details>${state.retainedSnapshot?'<p>The selected snapshot is retained in browser memory for your next message. The previous one-use consent is cleared; review the next exact message and check consent again. Exclude releases these selected file bytes.</p>':''}`:''}${state.requestText?`<details><summary>Exact Plan message for this review</summary><pre>${esc(state.requestText)}</pre></details>`:''}${r?`<details><summary>Exact document, source and profile binding</summary><dl><dt>Plan document</dt><dd>${r.documentContext.revisionId?esc(r.documentContext.revisionId):'First draft — no existing Plan document'}</dd>${r.documentContext.documentDigest?`<dt>Document SHA-256</dt><dd><code>${esc(r.documentContext.documentDigest)}</code></dd>`:''}<dt>Selected source SHA-256</dt><dd><code>${esc(r.sourceDigest)}</code></dd><dt>Authoring profile SHA-256</dt><dd><code>${esc(r.profileDigest)}</code></dd></dl></details><p>Profile: ${esc(r.profile)}. Complete selected files only; no truncation. This does not authorize architecture/workflow generation, source-base adoption, Build, or execution. A new message needs a new review. No retry for uncertain outcomes.</p>`:''}<p>No source is sent to the model until you check consent and press Send. Review only stages the complete files with the local host. Credential screening is conservative, not a guarantee: inspect and redact the selection yourself.</p><p>Supported UTF-8 source/text types: JS/TS, Python, Java, Go, Rust, C/C++, CSS/HTML, Markdown/TXT, JSON/YAML/TOML, SQL and shell. Maximum 200 files / 1 MB locally and 6,000 message bytes. Oversized serialized review payloads are rejected; the complete model request must also fit the existing 80 KB input and 96 KB body limits.</p></details></section>`;
}
