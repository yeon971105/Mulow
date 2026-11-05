/** Derived view only: never adds components or dependencies to the architecture. */
export function validateHierarchy(a){
 const nodes=new Map(a.nodes.map(n=>[n.id,n])), groups=new Map((a.groups||[]).map(g=>[g.id,g]));
 if(nodes.size!==a.nodes.length)throw Error('Architecture component IDs must be unique.');
 if(groups.size!==(a.groups||[]).length)throw Error('Architecture group IDs must be unique.');
 const all=new Map([...nodes,...groups]);if(all.size!==nodes.size+groups.size)throw Error('Group IDs must differ from component IDs.');
 for(const item of all.values()){const parent=item.parentId||item.groupId;if(parent&&!all.has(parent))throw Error('Unknown architecture parent: '+parent);const seen=new Set([item.id]);let p=parent;while(p){if(seen.has(p))throw Error('Architecture hierarchy contains a cycle.');seen.add(p);const ancestor=all.get(p);p=ancestor?.parentId||ancestor?.groupId;}}
 return true;
}
function inferredDomain(n){const s=[n.id,n.label,n.type,...(n.responsibilities||[])].join(' ').toLowerCase().replace(/[_/-]/g,' ');if(/\b(auth|authentication|authorization|identity|oauth)\b/.test(s))return 'Identity & access';if(/\b(cache|redis|memcached)\b/.test(s))return 'Cache';if(/\b(queue|broker|messaging|kafka|rabbitmq|event bus)\b/.test(s))return 'Messaging';if(/\b(observability|telemetry|metrics|logging|monitoring)\b/.test(s))return 'Observability';if(/\b(external|third party|integration|payment provider)\b/.test(s))return 'External services';if(/\b(database|sql|postgres|mysql|datastore|mongodb|db)\b/.test(s))return 'Database';if(/\b(frontend|front end|view|screen|ui|browser|client|web application|cart state|checkout|catalog filter)\b/.test(s))return 'Frontend';if(/\b(backend|back end|api|service|repository|controller|server|worker)\b/.test(s))return 'Backend';return 'Other components';}
const tone=label=>/front|client|browser/i.test(label)?'frontend':/database|storage|data\b/i.test(label)?'database':/back|server|service/i.test(label)?'backend':'other';
export function architectureView(a,{collapsed=[],inferGroups=true,leafHeight=76}={}){
 validateHierarchy(a);const items=new Map(),parent=new Map(),groups=[];const shut=new Set(collapsed);
 for(const g of a.groups||[]){const item={...g,kind:'group',tone:tone(g.label||g.id),inferred:false};items.set(g.id,item);groups.push(item);}
 const parentIds=new Set([...a.nodes,...(a.groups||[])].map(n=>n.parentId||n.groupId).filter(Boolean));
 for(const n of a.nodes){const item={...n,kind:parentIds.has(n.id)?'group':'node',component:true,inferred:false};item.tone=tone(n.label);items.set(n.id,item);if(item.kind==='group')groups.push(item);}
 function synthetic(label,inferred){const id='@boundary:'+label;if(!items.has(id)){const g={id,label,kind:'group',tone:tone(label),inferred,declared:!inferred};items.set(id,g);groups.push(g);}else{const g=items.get(id);g.inferred ||= inferred;g.declared ||= !inferred;}return id;}
 for(const g of a.groups||[])if(g.parentId||g.groupId)parent.set(g.id,g.parentId||g.groupId);
 for(const n of a.nodes){let p=n.parentId||n.groupId;if(!p){if(n.boundary)p=synthetic(n.boundary,false);else if(inferGroups&&items.get(n.id).kind!=='group')p=synthetic(inferredDomain(n),true);}items.get(n.id).groupingInferred=!!p&&!n.parentId&&!n.groupId&&!n.boundary;if(p&&p!==n.id)parent.set(n.id,p);}
 const children=id=>[...items.values()].filter(n=>(parent.get(n.id)||null)===id);
 const roots=children(null).sort((a,b)=>{const order={frontend:0,backend:1,database:2,other:3};return order[a.tone]-order[b.tone]||a.label.localeCompare(b.label);});
 const boxes=new Map();const gap=44,pad=24;
 const measures=new Map(),contents=new Map();
 function contentLayout(item){if(contents.has(item.id))return contents.get(item.id);const cs=children(item.id),ranks=architectureRootRanks(cs,parent,a.edges),positions=new Map();let w=260,h=118;
  if(ranks){const layers=new Map();for(const child of cs){const r=ranks.get(child.id);if(!layers.has(r))layers.set(r,[]);layers.get(r).push(child);}let x=pad;
   for(const [rank,layer]of [...layers].sort((a,b)=>a[0]-b[0])){let y=64+(rank%2)*18;for(const child of layer){const z=measure(child);positions.set(child.id,{x,y});y+=z.h+gap;}h=Math.max(h,y);x+=Math.max(...layer.map(c=>measure(c).w))+gap+32;}w=Math.max(w,x-gap-32+pad);
  }else{const cols=cs.some(c=>c.kind==='group')?1:Math.min(2,Math.max(1,cs.length));let y=64;for(let i=0;i<cs.length;i+=cols){let x=pad;const row=cs.slice(i,i+cols);for(const child of row){positions.set(child.id,{x,y});x+=measure(child).w+gap;}w=Math.max(w,x-gap+pad);y+=Math.max(...row.map(c=>measure(c).h))+gap;}h=Math.max(h,y);}
  const result={w,h,positions};contents.set(item.id,result);return result;
 }
 function measure(item){if(measures.has(item.id))return measures.get(item.id);const size=item.kind==='node'?{w:190,h:leafHeight}:shut.has(item.id)?{w:250,h:92}:contentLayout(item);measures.set(item.id,size);return size;}
 function place(item,x,y){const {w,h}=measure(item);boxes.set(item.id,{...item,x,y,w,h,collapsed:shut.has(item.id),memberCount:descendants(item.id).filter(id=>items.get(id).component).length,currentMemberCount:descendants(item.id).filter(id=>items.get(id).component&&!items.get(id).readOnlyHistory).length,historyMemberCount:descendants(item.id).filter(id=>items.get(id).component&&items.get(id).readOnlyHistory).length});if(item.kind!=='group'||shut.has(item.id))return;for(const child of children(item.id)){const p=contentLayout(item).positions.get(child.id);place(child,x+p.x,y+p.y);}}
 function descendants(id){const out=[];for(const child of children(id)){out.push(child.id,...descendants(child.id));}return out;}
 let x=32;for(const root of roots){place(root,x,80);x+=measure(root).w+32;}const width=Math.max(600,x),height=Math.max(330,...[...boxes.values()].map(b=>b.y+b.h+32));
 function visible(id){let result=id,p=parent.get(id);while(p){if(shut.has(p))result=p;p=parent.get(p);}return result;}
 const links=new Map();for(const e of a.edges){const from=visible(e.from),to=visible(e.to);if(from===to)continue;const key=from+'>'+to;if(!links.has(key))links.set(key,{from,to,count:0,original:[]});const l=links.get(key);l.count++;l.original.push(e);}
 return {boxes:[...boxes.values()],edges:[...links.values()],width,height,parent,visible,groups,inferred:groups.some(g=>g.inferred)};
}
export function architectureSelection(view,selected){const id=selected&&view.visible(selected),nodes=new Set(),edges=new Set();if(id){nodes.add(id);for(const e of view.edges)if(e.from===id||e.to===id){nodes.add(e.from);nodes.add(e.to);edges.add(e.from+'>'+e.to);}for(const n of [...nodes]){let p=view.parent.get(n);while(p){nodes.add(p);p=view.parent.get(p);}}}return {nodes,edges,active:!!id};}
export function architectureFitZoom(view,width,height){return Math.max(.001,Math.min(1.15,Math.max(1,width-48)/view.width,Math.max(1,height-125)/view.height));}

/** A semantic camera: only the immediate level is rendered, never the full nested tree. */
export function architectureScene(a,{focusId=null}={}){
 const tree=architectureView(a,{inferGroups:false}),items=new Map(tree.boxes.map(b=>[b.id,b])),parent=tree.parent;
 const children=id=>[...items.values()].filter(b=>(parent.get(b.id)||null)===id);
 if(!items.has(focusId)||items.get(focusId)?.kind!=='group')focusId=null;
 const chain=[];for(let id=focusId;id;id=parent.get(id))chain.unshift(items.get(id));
 const local=children(focusId),localIds=new Set(local.map(b=>b.id));
 function representative(id){let p=id;while(p){if(localIds.has(p))return p;p=parent.get(p);}return null;}
 function outsideRepresentative(id){let p=id;while(parent.has(p)&&parent.get(p)!==focusId)p=parent.get(p);return p;}
 const external=new Set(),links=new Map();
 for(const edge of a.edges){let from=representative(edge.from),to=representative(edge.to);if(!from&&!to)continue;if(!from){from=outsideRepresentative(edge.from);external.add(from);}if(!to){to=outsideRepresentative(edge.to);external.add(to);}if(from===to)continue;const key=from+'>'+to;let link=links.get(key);if(!link){link={from,to,count:0,original:[]};links.set(key,link);}link.count++;link.original.push(edge);}
 const cards=local.map(b=>({...b,external:false}));for(const id of external)if(items.has(id))cards.push({...items.get(id),external:true});
 // Topological columns, with cycles held in stable columns rather than inventing order.
 const ids=new Set(cards.map(c=>c.id)),incoming=new Map(cards.map(c=>[c.id,0])),level=new Map(cards.map(c=>[c.id,0]));
 for(const e of links.values())if(ids.has(e.from)&&ids.has(e.to))incoming.set(e.to,incoming.get(e.to)+1);
 const queue=cards.filter(c=>incoming.get(c.id)===0).map(c=>c.id),seen=new Set();
 while(queue.length){const id=queue.shift();seen.add(id);for(const e of links.values())if(e.from===id&&ids.has(e.to)){level.set(e.to,Math.max(level.get(e.to),level.get(id)+1));incoming.set(e.to,incoming.get(e.to)-1);if(incoming.get(e.to)===0)queue.push(e.to);}}
 // Bound column depth for readable groups of many nodes; the fold does not alter edges.
 const columns=new Map();for(const c of cards){const col=Math.min(level.get(c.id)||0,3);if(!columns.has(col))columns.set(col,[]);columns.get(col).push(c);}
 if(columns.size===1&&cards.length>3){columns.clear();cards.forEach((c,i)=>{const col=i%Math.min(3,Math.ceil(Math.sqrt(cards.length)));if(!columns.has(col))columns.set(col,[]);columns.get(col).push(c);});}
 const w=256,h=132,gapX=168,gapY=112,padX=54,padY=40,boxes=[];
 const maxRows=Math.max(1,...[...columns.values()].map(cs=>cs.length));
 for(const [col,cs] of [...columns].sort((a,b)=>a[0]-b[0]))cs.forEach((c,row)=>boxes.push({...c,x:padX+col*(w+gapX),y:padY+row*(h+gapY),w,h}));
 const width=Math.max(400,...boxes.map(b=>b.x+b.w+padX)),height=Math.max(260,padY+maxRows*h+(maxRows-1)*gapY+80);
 const byId=new Map(boxes.map(b=>[b.id,b]));let route=0;
 const edges=[...links.values()].filter(e=>byId.has(e.from)&&byId.has(e.to)).map(e=>{const b=byId.get(e.from),t=byId.get(e.to),forward=t.x>b.x;let points;
  if(forward&&t.x-b.x<=w+gapX){const x=b.x+b.w,y=b.y+b.h/2,tx=t.x,ty=t.y+t.h/2,m=x+(tx-x)/2;points=[[x,y],[m,y],[m,ty],[tx,ty]];}
  else if(t.x===b.x){const x=b.x+b.w,y=b.y+b.h/2,tx=t.x+t.w,ty=t.y+t.h/2,channel=x+32+(route++%4)*14;points=[[x,y],[channel,y],[channel,ty],[tx,ty]];}else{const x=b.x+b.w,y=b.y+b.h/2,tx=t.x,ty=t.y+t.h/2,lane=height+20+(route++%8)*14;points=[[x,y],[x+38,y],[x+38,lane],[tx-38,lane],[tx-38,ty],[tx,ty]];}
  return {...e,points,path:points.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ')};
 });
 const routeMax=Math.max(width,...edges.flatMap(e=>e.points.map(p=>p[0]+32)));
 return {...tree,boxes,edges,width:routeMax,height:Math.max(height,...edges.flatMap(e=>e.points.map(p=>p[1]+32))),focusId,breadcrumbs:chain,localIds,visible:id=>representative(id)||(external.has(id)?id:external.has(outsideRepresentative(id))?outsideRepresentative(id):null),levelTitle:focusId?items.get(focusId).label:(a.specification?.project?.name||'System overview'),inferred:local.some(b=>b.inferred),parent,items};
}
export function architectureNavigate(a,current,target){const tree=architectureView(a,{inferGroups:false}),items=new Map(tree.boxes.map(b=>[b.id,b]));if(target==='@overview')return null;if(target==='@back')return tree.parent.get(current)||null;return items.get(target)?.kind==='group'?target:current||null;}

/** Normalized canvas gestures: ordinary scrolling pans; ctrl-wheel/trackpad pinch zooms. */
export function canvasGesture(state,event,viewport){
 const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.height:1;
 const cap=(x,n)=>Math.max(-n,Math.min(n,Number.isFinite(x)?x:0));
 const dx=cap(event.deltaX*unit,80),dy=cap(event.deltaY*unit,80);
 if(!event.ctrlKey)return {...state,x:state.x-(event.shiftKey&&!dx?dy:dx),y:state.y-(event.shiftKey&&!dx?0:dy)};
 const z=Math.max(viewport.minZoom??.05,Math.min(2.4,state.z*Math.exp(-cap(dy,40)*.0025))),ratio=z/state.z;
 const ax=event.clientX-viewport.left-viewport.width/2,ay=event.clientY-viewport.top-viewport.height/2;
 return {z,x:ax-(ax-state.x)*ratio,y:ay-(ay-state.y)*ratio};
}
export function focusCamera(box,scene,viewport,current){const z=Math.min(1.25,Math.max(current.z,Math.min(1.1,(viewport.width-80)/box.w,(viewport.height-80)/box.h)));return {z,x:-(box.x+box.w/2-scene.width/2)*z,y:-(box.y+box.h/2-scene.height/2)*z};}
/** One cancellable animation. New input starts from actual displayed state, never queued momentum. */
export function createCameraMotion({read,write,request,cancel,reduced=()=>false}){
 let frame=null,generation=0;
 function stop(){generation++;if(frame!==null)cancel(frame);frame=null;}
 function move(target,{duration=480,done}={}){stop();const token=generation,start={...read()};if(reduced()||duration===0){write(target);done?.();return;}let began=null;
  function tick(now){if(token!==generation)return;if(began===null)began=now-16;const p=Math.min(1,Math.max(0,(now-began)/duration)),t=1-Math.pow(1-p,3);write({x:start.x+(target.x-start.x)*t,y:start.y+(target.y-start.y)*t,z:start.z+(target.z-start.z)*t});if(p<1)frame=request(tick);else{frame=null;done?.();}}
  frame=request(tick);
 }
 return {move,stop,active:()=>frame!==null};
}

/** Layout-only SCC ranks from declared cross-container edges. No semantic nodes are added. */
export function architectureRootRanks(roots,parent,edges){
 const ids=new Set(roots.map(r=>r.id)),adj=new Map(roots.map(r=>[r.id,new Set()]));
 const root=id=>{const seen=new Set();while(!ids.has(id)&&parent.has(id)&&!seen.has(id)){seen.add(id);id=parent.get(id);}return ids.has(id)?id:null;};
 for(const e of edges){const from=root(e.from),to=root(e.to);if(from&&to&&from!==to)adj.get(from).add(to);}
 if(![...adj.values()].some(v=>v.size))return null;
 let index=0;const indices=new Map(),low=new Map(),stack=[],active=new Set(),components=[];
 function visit(id){indices.set(id,index);low.set(id,index++);stack.push(id);active.add(id);for(const to of adj.get(id)){if(!indices.has(to)){visit(to);low.set(id,Math.min(low.get(id),low.get(to)));}else if(active.has(to))low.set(id,Math.min(low.get(id),indices.get(to)));}if(low.get(id)===indices.get(id)){const members=[];let next;do{next=stack.pop();active.delete(next);members.push(next);}while(next!==id);components.push(members);}}
 for(const id of ids)if(!indices.has(id))visit(id);
 const owner=new Map();components.forEach((c,i)=>c.forEach(id=>owner.set(id,i)));const incoming=components.map(()=>new Set());for(const[from,tos]of adj)for(const to of tos)if(owner.get(from)!==owner.get(to))incoming[owner.get(to)].add(owner.get(from));
 const ranks=new Map();function rank(i){if(ranks.has(i))return ranks.get(i);const value=incoming[i].size?Math.max(...[...incoming[i]].map(rank))+1:0;ranks.set(i,value);return value;}
 return new Map([...ids].map(id=>[id,rank(owner.get(id))]));
}
/** One derived world per viewport layout. Zoom changes disclosure, never layout or node IDs. */
export function architectureWorld(a,{viewportWidth,overview=false}={}){
 const tree=architectureView(a,{inferGroups:false,leafHeight:104}),items=new Map(tree.boxes.map(b=>[b.id,b])),roots=tree.boxes.filter(b=>!tree.parent.has(b.id));
 if(overview){
  // Explicit overview has its own compact coordinate world. Detail geometry is
  // untouched, and zoom alone never switches between these coordinate systems.
  const narrow=Number.isFinite(viewportWidth)&&viewportWidth<600,compact=narrow&&viewportWidth<440;
  const cardWidth=280,cardHeight=compact?120:narrow?164:240,gap=compact?16:narrow?32:64,pad=compact?16:narrow?24:40;
  const cols=Math.min(3,Math.max(1,roots.length),Math.max(1,Math.floor(((viewportWidth||1100)-pad*2+gap)/(cardWidth+gap))));
  const boxes=roots.map((b,i)=>({...b,x:pad+(i%cols)*(cardWidth+gap),y:pad+Math.floor(i/cols)*(cardHeight+gap),w:cardWidth,h:b.kind==='group'?cardHeight:140,depth:0,collapsed:b.kind==='group'}));
  const allItems=new Map(tree.boxes.map(b=>{let depth=0,id=b.id;while(tree.parent.has(id)){depth++;id=tree.parent.get(id);}return [b.id,{...b,depth}];}));
  for(const b of boxes)allItems.set(b.id,b);
  return {...tree,boxes,width:Math.max(320,...boxes.map(b=>b.x+b.w+pad)),height:Math.max(260,...boxes.map(b=>b.y+b.h+pad)),maxDepth:0,items:allItems,overview:true,summaryBoxes:tree.boxes};
 }

 // Fit the root grid to the available canvas, not the browser window. A sidebar
 // and chat may leave a narrow canvas even on a desktop. Nested geometry stays
 // intact, and callers share this same viewport when rendering/fitting/focusing.
 const responsive=Number.isFinite(viewportWidth)&&viewportWidth>0;
 const gapX=responsive?56:150,gapY=responsive?52:130,padX=responsive?32:48,padY=36;
 const rootWidth=Math.max(220,...roots.map(b=>b.w));
 // A long one-column history stack defeats fit-to-view. For compact leaf roots,
 // balance larger sets into two columns even on narrow canvases; large nested
 // containers stay single-column so their intact bounds are not forced wider.
 const narrowCols=roots.length>4&&rootWidth<=280?2:1;
 const availableCols=responsive?(viewportWidth<600?narrowCols:Math.max(1,Math.floor((viewportWidth-padX*2+gapX)/(rootWidth+gapX)))):3;
 const cols=Math.min(3,Math.max(1,roots.length),availableCols),widths=Array.from({length:cols},(_,col)=>Math.max(responsive?220:280,...roots.filter((_,i)=>i%cols===col).map(b=>b.w))),heights=[];
 for(let i=0;i<roots.length;i+=cols)heights.push(Math.max(...roots.slice(i,i+cols).map(b=>b.h)));
 const offsets=new Map();roots.forEach((r,i)=>{const col=i%cols,row=Math.floor(i/cols);offsets.set(r.id,{x:padX+widths.slice(0,col).reduce((s,w)=>s+w+gapX,0)-r.x,y:padY+heights.slice(0,row).reduce((s,h)=>s+h+gapY,0)-r.y});});
 const ranks=architectureRootRanks(roots,tree.parent,a.edges);
 if(ranks){
  const layers=new Map();for(const r of roots){const rank=ranks.get(r.id);if(!layers.has(rank))layers.set(rank,[]);layers.get(rank).push(r);}
  const narrow=responsive&&viewportWidth<600;let cursor=narrow?padY:padX;
  for(const [rank,layer]of [...layers].sort((a,b)=>a[0]-b[0])){
   // Narrow canvases flow downward; wide canvases flow left-to-right. Parallel
   // components share a rank, cycles remain together without fabricated order.
   if(narrow){let y=cursor;for(const r of layer){offsets.set(r.id,{x:padX+(rank%2)*16-r.x,y:y-r.y});y+=r.h+gapY;}cursor=y+24;}
   else{let y=padY+(rank%2)*32;for(const r of layer){offsets.set(r.id,{x:cursor-r.x,y:y-r.y});y+=r.h+gapY;}cursor+=Math.max(...layer.map(r=>r.w))+gapX+32;}
  }
 }

 let maxDepth=0;const boxes=tree.boxes.map(b=>{let root=b.id,depth=0;while(tree.parent.has(root)){root=tree.parent.get(root);depth++;}maxDepth=Math.max(maxDepth,depth);const o=offsets.get(root);return {...b,x:b.x+o.x,y:b.y+o.y,depth};});
 return {...tree,boxes,width:Math.max(responsive?320:400,...boxes.map(b=>b.x+b.w+padX)),height:Math.max(260,...boxes.map(b=>b.y+b.h+48)),maxDepth,items:new Map(boxes.map(b=>[b.id,b]))};
}
// Initial import is legible; Overview remains the explicit whole-world fit.
export function architectureInitialCamera(world,viewport){
 const leaf=world.boxes.filter(b=>b.kind!=='group').sort((a,b)=>a.x-b.x||a.y-b.y)[0]||world.boxes[0];if(!leaf)return {x:0,y:0,z:1};
 const z=1,cx=leaf.x+leaf.w/2,cy=leaf.y+leaf.h/2;
 return {z,x:Math.min(viewport.width/2,150)-viewport.width/2-(cx-world.width/2)*z,y:Math.min(viewport.height/2,170)-viewport.height/2-(cy-world.height/2)*z};
}
export function architectureLevel(zoom,maxDepth){return zoom>=2.39?maxDepth:Math.min(maxDepth,Math.max(0,Math.floor((zoom-.85)/.5)+1));}
/** Bounded rectilinear corridors with rounded corners; never route through cards. */
export function architectureObstacleRoute(from,to,obstacles,{fromSlot=.5,toSlot=.5,lane=0,avoidRoutes=[]}={}){
 if(!from||!to||obstacles.length>200)return {path:'',points:[],routingUnavailable:true};
 const gap=12,ports=(b,slot)=>{const insetX=Math.min(22,b.w/3),insetY=Math.min(22,b.h/3),x=b.x+insetX+(b.w-2*insetX)*slot,y=b.y+insetY+(b.h-2*insetY)*slot;return [[b.x-12,y],[b.x+b.w+12,y],[x,b.y-12],[x,b.y+b.h+12]];};
 const rects=obstacles.map(b=>({x:b.x-(b.id===from.id||b.id===to.id?1:gap),y:b.y-(b.id===from.id||b.id===to.id?1:gap),r:b.x+b.w+(b.id===from.id||b.id===to.id?1:gap),b:b.y+b.h+(b.id===from.id||b.id===to.id?1:gap)}));
 const nearest=(values,a,b)=>[...new Set(values)].sort((x,y)=>(Math.abs(x-a)+Math.abs(x-b))-(Math.abs(y-a)+Math.abs(y-b))).slice(0,32);
 const xs=nearest(rects.flatMap(r=>[r.x-8-(lane%4)*8,r.r+8+(lane%4)*8]),from.x+from.w/2,to.x+to.w/2),ys=nearest(rects.flatMap(r=>[r.y-8-(lane%4)*8,r.b+8+(lane%4)*8]),from.y+from.h/2,to.y+to.h/2),candidates=[];
 const add=points=>{const p=points.filter((v,i)=>!i||v[0]!==points[i-1][0]||v[1]!==points[i-1][1]);candidates.push({points:p,length:p.slice(1).reduce((n,v,i)=>n+Math.abs(v[0]-p[i][0])+Math.abs(v[1]-p[i][1]),0)+(p.length-2)*12});};
 for(const a of ports(from,fromSlot))for(const b of ports(to,toSlot)){add([a,[a[0],b[1]],b]);add([a,[b[0],a[1]],b]);for(const x of xs)add([a,[x,a[1]],[x,b[1]],b]);for(const y of ys)add([a,[a[0],y],[b[0],y],b]);}
 const hits=(a,b,r)=>a[0]===b[0]?a[0]>r.x&&a[0]<r.r&&Math.max(a[1],b[1])>r.y&&Math.min(a[1],b[1])<r.b:a[1]>r.y&&a[1]<r.b&&Math.max(a[0],b[0])>r.x&&Math.min(a[0],b[0])<r.r;
 const boundary=(p,b)=>[Math.max(b.x,Math.min(b.x+b.w,p[0])),Math.max(b.y,Math.min(b.y+b.h,p[1]))],otherRects=obstacles.filter(b=>b.id!==from.id&&b.id!==to.id).map(b=>({x:b.x-gap,y:b.y-gap,r:b.x+b.w+gap,b:b.y+b.h+gap}));
 const overlaps=(a,b,c,d)=>a[0]===b[0]&&c[0]===d[0]&&a[0]===c[0]?Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))-Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))>1:a[1]===b[1]&&c[1]===d[1]&&a[1]===c[1]&&Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))-Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))>1;
 const selected=candidates.sort((a,b)=>a.length-b.length).find(c=>c.points.slice(1).every((b,i)=>!rects.some(r=>hits(c.points[i],b,r))&&!avoidRoutes.some(points=>points.slice(1).some((d,j)=>overlaps(c.points[i],b,points[j],d))))&&!otherRects.some(r=>hits(boundary(c.points[0],from),c.points[0],r)||hits(c.points.at(-1),boundary(c.points.at(-1),to),r)));
 if(!selected)return {path:'',points:[],routingUnavailable:true};
 const p=[boundary(selected.points[0],from),...selected.points,boundary(selected.points.at(-1),to)];let path=`M${p[0][0]} ${p[0][1]}`;
 for(let i=1;i<p.length-1;i++){const prev=p[i-1],at=p[i],next=p[i+1],before=Math.abs(at[0]-prev[0])+Math.abs(at[1]-prev[1]),after=Math.abs(next[0]-at[0])+Math.abs(next[1]-at[1]),r=Math.min(6,before/2,after/2),a=[at[0]+Math.sign(prev[0]-at[0])*r,at[1]+Math.sign(prev[1]-at[1])*r],b=[at[0]+Math.sign(next[0]-at[0])*r,at[1]+Math.sign(next[1]-at[1])*r];path+=` L${a[0]} ${a[1]} Q${at[0]} ${at[1]} ${b[0]} ${b[1]}`;}
 path+=` L${p.at(-1)[0]} ${p.at(-1)[1]}`;return {path,points:p,routingUnavailable:false};
}
export function architectureWorldLevel(world,a,level){
 const visible=id=>{let b=world.items.get(id);while(b&&b.depth>level)b=world.items.get(world.parent.get(b.id));return b?.id||null;},links=new Map();
 for(const edge of a.edges){const from=visible(edge.from),to=visible(edge.to);if(!from||!to||from===to)continue;const key=from+'>'+to;if(!links.has(key))links.set(key,{from,to,count:0,original:[]});const l=links.get(key);l.count++;l.original.push(edge);}
 const obstacles=world.boxes.filter(b=>b.depth<=level&&(b.kind!=='group'||b.depth===level));
 const raw=[...links.values()],edges=[];for(const [index,e]of raw.entries()){const sourceIncidents=raw.filter(x=>x.from===e.from||x.to===e.from),targetIncidents=raw.filter(x=>x.from===e.to||x.to===e.to),reverse=edges.find(x=>x.from===e.to&&x.to===e.from);edges.push({...e,...architectureObstacleRoute(world.items.get(e.from),world.items.get(e.to),obstacles,{fromSlot:(sourceIncidents.indexOf(e)+1)/(sourceIncidents.length+1),toSlot:(targetIncidents.indexOf(e)+1)/(targetIncidents.length+1),lane:index,avoidRoutes:reverse&&!reverse.routingUnavailable?[reverse.points]:[]})});}
 return {...world,edges,visible};
}
export function architectureWorldFocus(world,a,id,viewport,current,overlay=null){
 const target=world.items.get(id);if(!target)return current;
 const level=Math.max(target.depth,target.kind==='group'?target.depth+1:target.depth),view=architectureWorldLevel(world,a,level),ids=new Set([id]);
 for(const e of view.edges)if(e.from===id||e.to===id){ids.add(e.from);ids.add(e.to);}
 // Actual direct relations of a container's descendants also remain in the framing context.
 const within=n=>{while(n){if(n===id)return true;n=world.parent.get(n);}return false;};
 for(const e of a.edges){if(within(e.from)&&!within(e.to))ids.add(view.visible(e.to));if(within(e.to)&&!within(e.from))ids.add(view.visible(e.from));}
 const boxes=[...ids].map(i=>world.items.get(i)).filter(Boolean),left=Math.min(...boxes.map(b=>b.x)),top=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h));
 let area={x:0,y:0,w:viewport.width,h:viewport.height};
 if(overlay){const gap=16,l=Math.max(0,overlay.left-viewport.left),r=Math.min(viewport.width,overlay.left+overlay.width-viewport.left),t=Math.max(0,overlay.top-viewport.top),b=Math.min(viewport.height,overlay.top+overlay.height-viewport.top);
  if(r>0&&l<viewport.width&&b>0&&t<viewport.height){const choices=[{x:gap,y:gap,w:l-2*gap,h:viewport.height-2*gap},{x:r+gap,y:gap,w:viewport.width-r-2*gap,h:viewport.height-2*gap},{x:gap,y:gap,w:viewport.width-2*gap,h:t-2*gap},{x:gap,y:b+gap,w:viewport.width-2*gap,h:viewport.height-b-2*gap}].filter(a=>a.w>0&&a.h>0);if(choices.length)area=choices.sort((a,b)=>b.w*b.h-a.w*a.h)[0];}
 }
 const margin=overlay?40:80,fit=Math.min((area.w-margin)/(right-left),(area.h-margin)/(bottom-top));
 const reveal=Math.min(2.4,.9+Math.max(0,level-1)*.5),preferred=Math.min(2.4,Math.max(reveal,Math.min(1.35,fit))),z=overlay?Math.max(.2,Math.min(preferred,(area.w-24)/target.w,(area.h-24)/target.h)):preferred;
 // Favor the selected region if all neighbors cannot fit at a readable scale.
 const cx=fit>=reveal?(left+right)/2:target.x+target.w/2,cy=fit>=reveal?(top+bottom)/2:target.y+target.h/2;
 return {z,x:area.x+area.w/2-viewport.width/2-(cx-world.width/2)*z,y:area.y+area.h/2-viewport.height/2-(cy-world.height/2)*z};
}
export function architectureWorldSelection(world,a,level,selected){
 const view={visible:id=>{let b=world.items.get(id);while(b&&b.depth>level)b=world.items.get(world.parent.get(b.id));return b?.id||null;}},nodes=new Set(),edges=new Set();if(!selected||!world.items.has(selected))return {nodes,edges,active:false};
 const inside=id=>{while(id){if(id===selected)return true;id=world.parent.get(id);}return false;};
 for(const b of world.boxes)if(inside(b.id))nodes.add(view.visible(b.id));
 for(const e of a.edges)if(inside(e.from)||inside(e.to)){const from=view.visible(e.from),to=view.visible(e.to);nodes.add(from);nodes.add(to);if(from!==to)edges.add(from+'>'+to);}
 for(const id of [...nodes]){let p=world.parent.get(id);while(p){nodes.add(p);p=world.parent.get(p);}}
 return {nodes,edges,active:true};
}
export function architectureWorldFit(world,viewport){return Math.max(.001,Math.min(1.15,Math.max(1,viewport.width-48)/world.width,Math.max(1,viewport.height-48)/world.height));}

/** Workflow focus uses the same camera coordinates, but avoids the open Work overlay. */
export function workflowFocusCamera(position,scene,viewport,current,overlay=null){
 const W=viewport.width,H=viewport.height,gap=16,top=64,bottom=64;
 let area={x:gap,y:top,w:Math.max(1,W-2*gap),h:Math.max(1,H-top-bottom)};
 if(overlay){const l=Math.max(0,overlay.left-viewport.left),r=Math.min(W,overlay.left+overlay.width-viewport.left),t=Math.max(0,overlay.top-viewport.top),b=Math.min(H,overlay.top+overlay.height-viewport.top);
  if(r>0&&l<W&&b>top&&t<H-bottom){const choices=[{x:gap,y:top,w:l-2*gap,h:H-top-bottom},{x:r+gap,y:top,w:W-r-2*gap,h:H-top-bottom},{x:gap,y:top,w:W-2*gap,h:t-top-gap},{x:gap,y:b+gap,w:W-2*gap,h:H-bottom-b-gap}].filter(a=>a.w>0&&a.h>0);if(choices.length)area=choices.sort((a,b)=>b.w*b.h-a.w*a.h)[0];}
 }
 const node={w:220,h:180},fit=Math.max(.2,Math.min(area.w/node.w,area.h/node.h,2.4));
 // Fit-all can shrink a large graph to 20%; selecting a node should make its
 // actual label readable even when the tiny node was already in the viewport.
 const z=Math.min(fit,Math.max(.85,current.z));
 return {z,x:area.x+area.w/2-W/2-(position[0]-scene.width/2)*z,y:area.y+area.h/2-H/2-(position[1]+56-scene.height/2)*z};
}
