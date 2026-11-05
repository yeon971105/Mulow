// IME composition owns its DOM until committed. Other renders preserve only
// the currently focused session's composer, never steal focus from elsewhere.
export function createComposerFocus({getSessionId,getField,getActive,onCommit}){
 let composition=null,pending=false;
 return {start(field){composition={field,sessionId:getSessionId()};},end(field){if(composition?.field!==field)return;const id=composition.sessionId;composition=null;onCommit(field.value,id);if(pending){pending=false;return id;}},before(){const field=getField();if(composition&&(composition.sessionId!==getSessionId()||composition.field!==field)){composition=null;pending=false;}if(composition&&composition.sessionId===getSessionId()&&composition.field===field){pending=true;return {defer:true};}return field&&getActive()===field&&field.dataset.sessionId===getSessionId()?{focused:true,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,scrollTop:field.scrollTop,sessionId:getSessionId()}:{};},after(saved){if(!saved?.focused||saved.sessionId!==getSessionId())return;const field=getField();if(!field)return;field.focus({preventScroll:true});field.setSelectionRange(Math.min(saved.start,field.value.length),Math.min(saved.end,field.value.length),saved.direction);field.scrollTop=saved.scrollTop;},isComposing:()=>!!composition};
}

// Native file dialogs keep their backing DOM node until change/cancel. A health
// render must not detach it, and a late result must never target a new session.
export function createFilePickerFocus({getScope}){
 let active=null;const owners=new WeakMap(),origins=new WeakMap(),watched=new WeakSet();
 return {
  start(field){active={field,scope:getScope()};owners.set(field,active.scope);origins.set(field,active.scope);if(!watched.has(field)){watched.add(field);field.addEventListener('change',event=>{if(origins.get(field)!==getScope()||!field.isConnected)event.stopImmediatePropagation();},true);}field.value='';},
  before(){if(!active)return false;if(active.scope!==getScope()||!active.field.isConnected){active=null;return false;}return true;},
  finish(field){const scope=owners.get(field);owners.delete(field);if(active?.field===field)active=null;return scope!==undefined&&scope===getScope()&&field.isConnected;}
 };
}
