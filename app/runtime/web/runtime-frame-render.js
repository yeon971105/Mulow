/** Keep a live iframe AND its ancestor chain connected during shell updates. */
const parkedByRoot=new WeakMap();
const activeSessionByRoot=new WeakMap();
const activeIdentityByRoot=new WeakMap();
const attrs=['src','srcdoc','sandbox','referrerpolicy'];
const key=x=>JSON.stringify([x.sessionId,x.operationId,x.runId,x.revision,x.url]);
const valid=x=>x&&typeof x.sessionId==='string'&&x.sessionId.length>0&&x.sessionId.length<=160&&/^[-A-Za-z0-9_]{8,100}$/.test(x.operationId||'')&&/^run_[A-Za-z0-9-]+$/.test(x.runId||'')&&/^[a-f0-9]{64}$/.test(x.revision||'')&&typeof x.url==='string'&&Number.isFinite(Date.parse(x.expiresAt))&&Date.parse(x.expiresAt)>Date.now();
const matches=(frame,x)=>frame&&frame.getAttribute('src')===x.url&&!frame.getAttribute('srcdoc')&&frame.getAttribute('sandbox')==='allow-scripts'&&frame.getAttribute('referrerpolicy')==='no-referrer';
const path=(node,top)=>{const result=[];for(let n=node;n&&n!==top;n=n.parentNode)result.unshift(n);return result;};
function uniqueOwner(frame,entries,sessionId=null){const found=entries.filter(x=>(!sessionId||x.sessionId===sessionId)&&matches(frame,x));return found.length===1?found[0]:null;}
function cache(root){let c=parkedByRoot.get(root);if(!c){c=new Map();parkedByRoot.set(root,c);}return c;}
function forget(c,k){const old=c.get(k);if(!old)return;clearTimeout(old.timer);old.path[0].remove();c.delete(k);}
function schedule(c,k,entry,expiresAt){clearTimeout(entry.timer);entry.expiresAt=expiresAt;entry.timer=setTimeout(()=>{if(c.get(k)===entry)forget(c,k);},Math.max(0,Math.min(Date.parse(expiresAt)-Date.now(),2147483647)));entry.timer?.unref?.();}
function prune(c,entries){const allowed=new Map(entries.map(x=>[key(x),x]));for(const [k,v] of c){const x=allowed.get(k);if(!x||!v.path[0].parentNode)forget(c,k);else if(v.expiresAt!==x.expiresAt)schedule(c,k,v,x.expiresAt);}}
function park(root,frame,owner,c){
 const chain=path(frame,root);if(chain.length<2||chain.at(-1)!==frame)return false;
 const k=key(owner);if(c.has(k))return false;
 // Remove non-frame siblings while leaving every frame ancestor connected.
 for(let i=0;i<chain.length-1;i++){
  const parent=chain[i],child=chain[i+1];for(const n of [...parent.childNodes])if(n!==child)n.remove();
  for(const a of [...parent.attributes])parent.removeAttribute(a.name);
 }
 const shell=chain[0];shell.setAttribute('hidden','');shell.setAttribute('inert','');shell.setAttribute('aria-hidden','true');shell.setAttribute('data-muse-runtime-parked','');
 const entry={path:chain,frame,timer:null,expiresAt:null};c.set(k,entry);schedule(c,k,entry,owner.expiresAt);return true;
}
function patch(root,oldPath,newPath,template,protectedShells){
 function walk(parent,nextParent,index){
  const branch=oldPath[index],nextBranch=newPath[index];
  for(const child of [...parent.childNodes])if(child!==branch&&!(parent===root&&protectedShells.has(child)))child.remove();
  let passed=false;
  for(const child of [...nextParent.childNodes]){
   if(child===nextBranch){passed=true;continue;}
   const copy=child.cloneNode(true);
   if(passed)parent.appendChild(copy);else parent.insertBefore(copy,branch);
  }
  if(branch===oldPath.at(-1))return;
  for(const attr of [...branch.attributes])if(!nextBranch.hasAttribute(attr.name))branch.removeAttribute(attr.name);
  for(const attr of [...nextBranch.attributes])if(branch.getAttribute(attr.name)!==attr.value)branch.setAttribute(attr.name,attr.value);
  walk(branch,nextBranch,index+1);
 }
 walk(root,template.content,0);
}
export function renderPreservingRuntimeFrame(root, markup, {sessionId=null,retained=[]}={}) {
 const previousSession=activeSessionByRoot.get(root)||null;
 const previousIdentity=activeIdentityByRoot.get(root)||null;
 const recordSession=()=>{if(sessionId)activeSessionByRoot.set(root,sessionId);const owner=uniqueOwner(root.querySelector?.('.project-runtime iframe'),entries,sessionId);if(owner)activeIdentityByRoot.set(root,key(owner));else activeIdentityByRoot.delete(root);};
 const previousDetails=root.querySelector?.('.runtime-details');
 const savedDetails=previousDetails?.nodeName==='DETAILS'&&previousDetails.getAttribute('data-runtime-operation')?
  {operation:previousDetails.getAttribute('data-runtime-operation'),open:previousDetails.open===true}:null;
 const previousVersions=root.querySelector?.('.runtime-source-menu');
 const savedVersions=previousVersions?.nodeName==='DETAILS'&&previousVersions.getAttribute('data-runtime-session')?
  {session:previousVersions.getAttribute('data-runtime-session'),open:previousVersions.open===true}:null;
 const goalPanel=root.querySelector?.('.goal-details[data-goal-session]');
 const goalSession=goalPanel?.getAttribute('data-goal-session');
 const goalDetails=goalSession?new Map([...goalPanel.querySelectorAll('details[data-goal-details]')].map(d=>[d.getAttribute('data-goal-details'),d.open===true])):null;
 const previousSwitcher=root.querySelector?.('.work-switcher[data-work-session][data-work-id]');
 const switchSession=previousSwitcher?.getAttribute('data-work-session'),switchWork=previousSwitcher?.getAttribute('data-work-id');
 const focusedSwitch=previousSwitcher?.contains?.(root.ownerDocument?.activeElement)?root.ownerDocument.activeElement:null;
 const savedSwitcher=switchSession&&switchWork?{session:switchSession,work:switchWork,open:previousSwitcher.open===true,scroll:previousSwitcher.querySelector?.('.work-switcher-list')?.scrollTop||0,focus:focusedSwitch?.nodeName==='SUMMARY'?'summary':focusedSwitch?.getAttribute?.('data-work')||null}:null;
 const restoreSwitcher=()=>{
  const next=root.querySelector?.('.work-switcher[data-work-session][data-work-id]');
  if(!savedSwitcher||!next||next.getAttribute('data-work-session')!==savedSwitcher.session||next.getAttribute('data-work-id')!==savedSwitcher.work)return;
  next.open=savedSwitcher.open;const list=next.querySelector?.('.work-switcher-list');if(list)list.scrollTop=savedSwitcher.scroll;
  if(savedSwitcher.focus&&savedSwitcher.open){const focus=savedSwitcher.focus==='summary'?next.querySelector?.('summary'):[...(list?.querySelectorAll?.('button[data-work]')||[])].find(b=>b.getAttribute('data-work')===savedSwitcher.focus);focus?.focus?.({preventScroll:true});}
 };
 const restoreDetails=()=>{const details=root.querySelector?.('.runtime-details');if(savedDetails&&details?.nodeName==='DETAILS'&&details.getAttribute('data-runtime-operation')===savedDetails.operation)details.open=savedDetails.open;const versions=root.querySelector?.('.runtime-source-menu');if(savedVersions&&versions?.nodeName==='DETAILS'&&versions.getAttribute('data-runtime-session')===savedVersions.session)versions.open=savedVersions.open;const goal=root.querySelector?.('.goal-details[data-goal-session]');if(goalDetails&&goal?.getAttribute('data-goal-session')===goalSession)for(const d of goal.querySelectorAll('details[data-goal-details]'))if(goalDetails.has(d.getAttribute('data-goal-details')))d.open=goalDetails.get(d.getAttribute('data-goal-details'));restoreSwitcher();};
 const entries=Array.isArray(retained)?retained.filter(valid):[],c=cache(root);prune(c,entries);
 // A reviewed interactive static frame is preserved only in the same visible session; never parked as a Docker runtime.
 const oldFrame=root.querySelector?.('.project-runtime iframe')||root.querySelector?.('.static-source-preview[data-interactive="true"] iframe'),doc=root.ownerDocument;
 const replace=template=>{
  if(!c.size){root.innerHTML=markup;recordSession();restoreDetails();return {preserved:false};}
  const protectedShells=new Set([...c.values()].map(v=>v.path[0]));
  for(const child of [...root.childNodes])if(!protectedShells.has(child))child.remove();
  const before=[...root.childNodes].find(n=>protectedShells.has(n))||null;
  for(const child of [...template.content.childNodes])root.insertBefore(child.cloneNode(true),before);
  recordSession();restoreDetails();return {preserved:false};
 };
 if(!doc?.createElement||!oldFrame&&!c.size)return replace();
 const template=doc.createElement('template');template.innerHTML=markup;
 const newFrame=template.content.querySelector('.project-runtime iframe')||template.content.querySelector('.static-source-preview[data-interactive="true"] iframe');
 const matchedOldOwner=uniqueOwner(oldFrame,entries,previousSession),oldOwner=matchedOldOwner&&(!previousIdentity||key(matchedOldOwner)===previousIdentity)?matchedOldOwner:null,newOwner=uniqueOwner(newFrame,entries,sessionId);
 const sameFrame=oldFrame&&newFrame&&attrs.every(a=>oldFrame.getAttribute(a)===newFrame.getAttribute(a))&&(!sessionId||!previousSession||previousSession===sessionId)&&(!previousIdentity||newOwner&&key(newOwner)===previousIdentity);
 if(sameFrame){
  const oldPath=path(oldFrame,root),newPath=path(newFrame,template.content);
  if(oldPath.length!==newPath.length||oldPath.some((n,i)=>n.nodeName!==newPath[i].nodeName))return {preserved:true,deferred:true};
  patch(root,oldPath,newPath,template,new Set([...c.values()].map(v=>v.path[0])));recordSession();restoreDetails();return {preserved:true};
 }
 if(oldFrame&&oldOwner&&sessionId&&oldOwner.sessionId!==sessionId)park(root,oldFrame,oldOwner,c);
 const parked=newOwner&&c.get(key(newOwner));
 if(parked&&newFrame){
  const newPath=path(newFrame,template.content),oldPath=parked.path;
  if(oldPath.length===newPath.length&&oldPath.every((n,i)=>n.nodeName===newPath[i].nodeName)&&attrs.every(a=>parked.frame.getAttribute(a)===newFrame.getAttribute(a))){
   clearTimeout(parked.timer);c.delete(key(newOwner));patch(root,oldPath,newPath,template,new Set([...c.values()].map(v=>v.path[0])));recordSession();restoreDetails();return {preserved:true};
  }
  forget(c,key(newOwner));
 }
 return replace(template);
}
