// Conservative label placement: an omitted canvas caption remains in component details.
export const labelOverlap=(a,b,pad=8)=>a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y;
export function architectureLabels(view,level){
 const occupied=view.boxes.filter(b=>b.depth<=level).map(b=>({x:b.x,y:b.y,w:b.w,h:b.kind==='group'&&b.depth<level?56:b.h}));
 const labels=new Map();
 for(const e of view.edges){
  const full=[...new Set(e.original.map(x=>x.label||x.protocol||x.type).filter(Boolean))].join(' · ')||(e.count>1?e.count+' links':'');
  if(!full)continue;
  const text=full.length>28?full.slice(0,25)+'…':full,w=Array.from(text).length*10+20,h=24;
  const candidates=[];
  for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i];if(a[1]!==b[1]||Math.abs(a[0]-b[0])<w+24)continue;const x=(a[0]+b[0]-w)/2;for(const offset of [-h-10,10])candidates.push({x,y:a[1]+offset,w,h});}
  const box=candidates.find(b=>b.x>=0&&b.y>=0&&b.x+b.w<=view.width&&b.y+b.h<=view.height&&!occupied.some(o=>labelOverlap(b,o)));
  if(box){occupied.push(box);labels.set(e,{...box,text,full});}
 }
 return labels;
}
