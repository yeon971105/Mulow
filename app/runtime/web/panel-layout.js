// Panel geometry is local UI state; never alters camera transforms or run state.
export function panelLayout(state={},viewport=1200){
 const v=Number.isFinite(viewport)?Math.max(280,viewport):1200,overlay=v<=900,chatVisible=!state.chatHidden;
 const sidebarMax=overlay?Math.max(180,Math.min(420,v-48)):Math.max(180,Math.min(420,v-360-(chatVisible?280:0)));
 const sidebar=Math.max(180,Math.min(sidebarMax,Number.isFinite(state.sidebarWidth)?state.sidebarWidth:220));
 const reserved=overlay||!state.sidebar?0:sidebar;
 const chatMax=Math.max(280,Math.min(560,v-reserved-360));
 const chat=Math.max(280,Math.min(chatMax,Number.isFinite(state.chatWidth)?state.chatWidth:370));
 return {sidebar,sidebarMax,chat,chatMax,canvas:v-reserved-(chatVisible&&v>650?chat:0),overlay};
}
export function resizeSidebarKey(key,width,max){return key==='Home'?180:key==='End'?max:width+(key==='ArrowRight'?16:key==='ArrowLeft'?-16:0);}
