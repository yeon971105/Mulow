// Keep a startup failure visible without reading workspace contents or secrets.
window.addEventListener('error',event=>{
 const app=document.getElementById('app');if(!app||app.childElementCount||app.textContent.trim())return;
 const p=document.createElement('p');p.textContent='Workspace could not load. Saved data has not been reset.';
 const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='Technical details';text.textContent=String(event.message||'Module loading failed').slice(0,240);details.append(summary,text);app.style.cssText='padding:32px;font:14px/1.6 -apple-system,sans-serif;color:#465365';app.append(p,details);
});
