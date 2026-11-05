// Presentation only: never retains a panel across a changed selection/session key.
export function createComponentInspectorPreservation({root,document}){
 const rendered=new WeakMap();let pending=null;
 const selector='.architecture-inspector.component-details';
 const detailKey=(el,i)=>JSON.stringify([i,el.className,el.querySelector('summary')?.textContent||'']);
 const focusKey=el=>el?JSON.stringify([el.tagName,el.id||'',...['data-action','data-component','aria-label'].map(k=>el.getAttribute(k)||''),el.tagName==='SUMMARY'?el.textContent:'']):null;
 return {
  before(key){
   pending=null;if(typeof key!=='string'||!key)return;const node=root.querySelector(selector),prior=node&&rendered.get(node);if(!node||prior?.key!==key)return;
   const active=document.activeElement;
   pending={key,node,html:prior.html,scroll:node.scrollTop,bodyScroll:node.querySelector('.component-details-body')?.scrollTop||0,details:[...node.querySelectorAll('details')].map((d,i)=>[detailKey(d,i),d.open]),active:node.contains(active)?active:null,focus:node.contains(active)?focusKey(active):null};
  },
  after(key){
   const saved=pending;pending=null;const fresh=root.querySelector(selector);if(!fresh)return;
   const html=fresh.innerHTML;rendered.set(fresh,{key,html});
   if(!saved||saved.key!==key||typeof key!=='string'||!key)return;
   let node=fresh;
   // A user toggling <details> does not change the last renderer-produced markup.
   if(saved.html!==undefined&&saved.html===html){fresh.replaceWith(saved.node);node=saved.node;}
   else{const open=new Map(saved.details);[...node.querySelectorAll('details')].forEach((d,i)=>{const k=detailKey(d,i);if(open.has(k))d.open=open.get(k);});}
   // Reattachment can restart CSS animations, even for the identical DOM node.
   node.style.animation='none';node.scrollTop=saved.scroll;const body=node.querySelector('.component-details-body');if(body)body.scrollTop=saved.bodyScroll;
   const current=document.activeElement;
   if(saved.focus&&(!current||current===document.body||current.isConnected===false)){
    const targets=node===saved.node&&node.contains(saved.active)?[saved.active]:[...node.querySelectorAll('button,summary,a,input,textarea,select,[tabindex]')].filter(el=>focusKey(el)===saved.focus);
    if(targets.length===1)targets[0].focus({preventScroll:true});
   }
  }
 };
}
