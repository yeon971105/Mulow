// Preserve reading position across live renders. Follow only while already near the end.
export function createWorkJournalViewport(){
 const positions=new Map();let current=null;
 const near=el=>el.scrollHeight-el.clientHeight-el.scrollTop<=40;
 function capture(){if(!current?.el?.isConnected)return;const {el,key}=current;positions.set(key,{top:el.scrollTop,follow:near(el)});if(current.button)current.button.hidden=near(el)||el.scrollHeight<=el.clientHeight;}
 function mount(el,button){current=null;if(!el)return;const key=el.dataset.journalKey;if(!key)return;const p=positions.get(key);current={el,button,key};el.scrollTop=!p||p.follow?el.scrollHeight:p.top;if(button)button.hidden=near(el)||el.scrollHeight<=el.clientHeight;el.addEventListener('scroll',()=>{if(current?.el===el)capture();},{passive:true});if(positions.size>100)positions.delete(positions.keys().next().value);}
 function jump(){if(!current)return;current.el.scrollTop=current.el.scrollHeight;capture();}
 return {capture,mount,jump};
}
