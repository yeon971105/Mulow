import {conversationActivityAt} from './sidebar.js';
export const welcome='What would you like to build? Import a plan in Plan, or describe your goal here to plan with Muse. Importing never starts design or Build.';
const legacyWelcomes=new Set([
 'What would you like to build? Describe it here, or choose Import & analyze to send a readable design excerpt to the selected provider. Local-only import does not send it.',
 'Describe your goal. MusePilot turns it into a bounded plan and coordinates model workers. Select a node to inspect recorded activity, outputs and blockers. Local file imports stay on this Mac.',
 'Describe your goal. MusePilot turns it into a bounded plan and coordinates model workers. Select a node to inspect recorded activity, outputs and blockers. Import & analyze sends your new readable design excerpt to the selected provider. Local-only imports remain on this Mac.'
]);
export function newSession(title='Untitled session'){return {id:crypto.randomUUID(),title,createdAt:Date.now(),messages:[{role:'assistant',kind:'welcome',text:welcome}],events:[],architecture:null,model:'spark',pinned:false,archived:false,deleted:false,deletedAt:null,previewReady:false,livePreviewDesired:true};}
// A recovered session is a view of recorded local-server evidence, not a restored chat.
export function recoveredSession(id,recoveredAt){const s=newSession('Recovered session · '+id.slice(0,8));s.id=id;s.chatMode='plan';s.messages=[{role:'assistant',text:'Recovered saved local-server history and artifacts. Original chats, project names and local imports are not stored in this history and were not recovered. Obvious credential-like text is redacted. No run was started or resumed. Plan approvals are cleared; review before continuing.'}];s.recovery={source:'local_server',recoveredAt,historyOnly:true,partial:false};return s;}
export function migrateState(s){
 for(const x of s.sessions){
  if(typeof x.livePreviewDesired!=='boolean')x.livePreviewDesired=true;
  delete x.designMode;
  x.lastConversationAt=conversationActivityAt(x);
  if(!x.model||x.model==='demo')x.model='spark';
  // Explicit simulator provenance, never title matching. All content remains restorable.
  if(x.deleted!==true&&x.workflow?.demo&&x.architecture?.source==='Café demo template'&&!x.legacyDemoPreserved){x.archived=true;x.legacyDemoPreserved=true;}
  x.pinned=!!x.pinned;x.archived=!!x.archived;x.deleted=x.deleted===true;x.deletedAt=x.deleted&&Number.isFinite(x.deletedAt)&&x.deletedAt>0?x.deletedAt:null;
  x.messages=x.messages.map((m,i)=>i===0&&m.role==='assistant'&&!m.id&&!m.createdAt&&legacyWelcomes.has(m.text)?{...m,kind:'welcome',text:welcome}:m);
 }
 return s;
}
const persistedBlobs=new WeakMap();
const STORAGE_KEY='musepilot-v1';
export function persistenceStatus(state){const record=persistedBlobs.get(state);if(!record||record.preimageKnown===false)return 'unavailable';if(record.conflict)return 'conflict';try{if(localStorage.getItem(STORAGE_KEY)!==record.raw){record.conflict=true;return 'conflict';}return record.failure?'unavailable':'current';}catch{record.failure={code:'storage_read_failed',bytes:null};return 'unavailable';}}
export function workspacePersistenceSnapshot(state){const r=persistedBlobs.get(state);return {raw:r?.raw??null,preimageKnown:!!r&&r.preimageKnown!==false,status:persistenceStatus(state)};}
export function attachWorkspacePersistence(state,raw){persistedBlobs.set(state,{raw});return state;}
export function persistenceDiagnostic(state){const failure=persistedBlobs.get(state)?.failure;return failure?{...failure}:null;}
export function persistState(state,{retry=false}={}){const record=persistedBlobs.get(state);if(!record||record.preimageKnown===false)return 'unavailable';let raw;try{const status=persistenceStatus(state);if(status==='conflict')return status;if(status!=='current'&&(!retry||!record.failure))return 'unavailable';if(localStorage.getItem(STORAGE_KEY)!==record.raw){record.conflict=true;return 'conflict';}}catch{record.failure={code:'storage_read_failed',bytes:null};return 'unavailable';}try{raw=JSON.stringify(state);}catch{record.failure={code:'serialization_failed',bytes:null};return 'unavailable';}try{localStorage.setItem(STORAGE_KEY,raw);record.raw=raw;delete record.failure;return 'saved';}catch(error){record.failure={code:['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name)?'quota_exceeded':error?.name==='SecurityError'?'storage_blocked':'storage_write_failed',bytes:new TextEncoder().encode(raw).length};return 'unavailable';}}
export function loadState(){let raw,read=false,readError=null;try{raw=localStorage.getItem(STORAGE_KEY);read=true;const s=JSON.parse(raw);if(s&&Array.isArray(s.sessions)&&s.sessions.length&&s.sessions.every(x=>typeof x.id==='string'&&typeof x.title==='string'&&Array.isArray(x.messages)&&Array.isArray(x.events))){if(!s.sessions.some(x=>x.id===s.current))s.current=s.sessions[0].id;const state=migrateState(s);persistedBlobs.set(state,{raw});return state;}}catch(error){if(!read)readError=error;}const s=newSession(),state={sessions:[s],current:s.id,sidebar:innerWidth>900};persistedBlobs.set(state,read?{raw,freshSessionId:s.id}:{preimageKnown:false,failure:{code:readError?.name==='SecurityError'?'storage_blocked':'storage_read_failed',bytes:null,retryable:false}});return state;}
// One updated tab owns writes. The preimage check still detects older clients.
export function createWorkspaceWriterLease({locks,isCurrent,onChange=()=>{}}){let status='pending',release=null,closed=false;const set=value=>{status=value;onChange(value);};const result={status:()=>status,stop(){if(closed)return;closed=true;set('released');release?.();}};if(!locks?.request){status='unavailable';return result;}Promise.resolve().then(()=>locks.request('mulo-workspace-writer-v1',{mode:'exclusive',ifAvailable:true},async lock=>{if(closed)return;if(!lock){set('readonly');return;}if(!isCurrent()){set('conflict');return;}await new Promise(resolve=>{release=resolve;set('writer');if(closed)resolve();});})).catch(()=>{if(!closed)set('unavailable');});return result;}
// Future request preference only; immutable run/model evidence is never rewritten.
export function canPreferMuseForIdleSession(s,{status,owned=false}={}){
 if(!s||status?.mock!==false||owned)return false;
 const live=s.liveRun,dispatch=s.lastMessageDispatch;
 if(live&&(!['completed','failed','cancelled'].includes(live.status)||live.accountingConfirmed!==true))return false;
 if(dispatch&&!['completed','failed','cancelled'].includes(dispatch.state))return false;
 if(s.linkedRestorePending||s.goalTransitionSubmission||['waiting','applying','pending','unconfirmed'].includes(s.draftRefinement?.state))return false;
 return true;
}
export function preferMuseForIdleSession(s,options={}){
 if(s?.model==='spark'||!canPreferMuseForIdleSession(s,options))return false;
 s.model='spark';if(s.pendingPlan)s.pendingPlan.approved=false;return true;
}

// Only the newly created, never-used startup session may adopt the deterministic test profile.
// Loaded workspaces and every live-provider mismatch retain their existing model identity.
export function alignFreshMockSession(state,status,{owned=false}={}){
 const record=persistedBlobs.get(state);if(status?.mock!==true||!['nebius','spark'].includes(status.modelChoice)||!record?.freshSessionId)return false;
 const s=state.sessions?.find(item=>item.id===record.freshSessionId);
 const w=s?.workflow,emptyWorkflow=!w||(Object.keys(w).length===5&&Object.keys(w).every(k=>['requests','tasks','selected','mode','revision'].includes(k))&&Array.isArray(w.requests)&&w.requests.length===0&&Array.isArray(w.tasks)&&w.tasks.length===0&&w.selected===null&&w.mode==='idle'&&w.revision===0);
 if(!s||state.current!==s.id||owned||s.goal||s.liveRun||s.lastMessageDispatch||s.pendingPlan||s.planProposal||s.architecture||!emptyWorkflow||s.runtimeRecord||s.chatAttachmentRevision||s.planningIntake?.state&&s.planningIntake.state!=='empty'||(s.messages||[]).some(m=>m.kind!=='welcome'||m.role!=='assistant')||['events','references','chatContextSelection','projectBundles','planHistory','designVersions','artifacts','agents'].some(key=>s[key]?.length)){delete record.freshSessionId;return false;}
 delete record.freshSessionId;if(s.model===status.modelChoice)return false;s.model=status.modelChoice;return true;
}
