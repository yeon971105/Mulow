// Isolated closed CSS subset parser/serializer. No production policy import.
const properties=new Set(('-webkit-font-smoothing clip box-sizing display position top right bottom left inset z-index width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left gap row-gap column-gap flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self justify-content justify-items justify-self order grid grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow grid-auto-columns grid-auto-rows color background background-color border border-top border-right border-bottom border-left border-color border-width border-style border-radius outline outline-color outline-width outline-style outline-offset box-shadow opacity overflow overflow-x overflow-y font font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform text-overflow white-space overflow-wrap word-break list-style list-style-type cursor pointer-events appearance accent-color visibility vertical-align transform transform-origin transition transition-property transition-duration transition-timing-function').split(' '));
const functions=new Set(['rect','rgb','rgba','hsl','hsla','minmax','repeat','calc','min','max','clamp','var','translate','translateX','translateY','scale','rotate']);
const pseudos=new Set(['active','hover','focus','focus-visible','focus-within','checked','disabled','enabled','first-child','last-child','empty','root']);
const fail=code=>{
  throw Error(code)}
;
function tokenize(css){
  const out=[];
  let i=0;
  while(i<css.length){
    const c=css[i];
    if(/\s/.test(c)){
      i++;
      continue}
    if(c==='\\'||c==='"'||c==="'"||c==='/'&&css[i+1]==='*')fail('css_obfuscation_or_string_unsupported');
    if(c.charCodeAt(0)<32||c.charCodeAt(0)>126)fail('css_character_unsupported');
    const start=i;
    let m;
    if((m=/^(?:--[a-zA-Z][a-zA-Z0-9-]*|-?[a-zA-Z_][a-zA-Z0-9_-]*)/.exec(css.slice(i)))){
      out.push({
        kind:'ident',value:m[0]}
      );
      i+=m[0].length;
    }
    else if((m=/^(?:\d*\.\d+|\d+)(?:[a-zA-Z]+|%)?/.exec(css.slice(i)))){
      out.push({
        kind:'number',value:m[0]}
      );
      i+=m[0].length;
    }
    else if('{}():;,.#*>+~[]=-/!@'.includes(c)){
      out.push({
        kind:c,value:c}
      );
      i++;
    }
    else fail('css_token_unsupported');
    out[out.length-1].start=start;
    out[out.length-1].end=i;
    if(out.length>12000)fail('css_token_limit');
  }
  return out;
}
export function parseCssV2(css){
  try{
    if(typeof css!=='string'||new TextEncoder().encode(css).length>100000)fail('css_size_limit');
    const tokens=tokenize(css);
    let pos=0,nodes=0;
    const peek=()=>tokens[pos],take=()=>tokens[pos++],expect=value=>{
      const t=take();
      if(t?.value!==value)fail('css_syntax');
      return t}
    ;
    function selector(){
      const start=peek()?.start;
      const items=[];
      let count=0;
      while(peek()&&peek().value!=='{'){
        const t=take();
        if(++count>256)fail('css_selector_limit');
        if(t.kind==='ident'||['*',',','>','+','~'].includes(t.value)){
          items.push(t.value);
          continue}
        if(t.value==='.'||t.value==='#'){
          const name=take();
          if(name?.kind!=='ident'&&!(t.value==='#'&&name?.kind==='number'))fail('css_selector');
          items.push(t.value+name.value);
          continue}
        if(t.value===':'){
          const name=take();
          if(name?.kind==='ident'&&name.value==='not'){expect('(');expect(':');const state=take();if(state?.kind!=='ident'||!['disabled','enabled','checked'].includes(state.value))fail('css_pseudo_unsupported');expect(')');items.push(':not(:'+state.value+')');continue;}
          if(name?.kind!=='ident'||!pseudos.has(name.value))fail('css_pseudo_unsupported');
          items.push(':'+name.value);
          continue}
        if(t.value==='['){
          const name=take();
          if(name?.kind!=='ident'||!['type','disabled','checked','aria-expanded','aria-selected'].includes(name.value))fail('css_attribute_unsupported');
          let attr='['+name.value;
          if(peek()?.value==='='){
            take();
            const value=take();
            if(!value||!['ident','number'].includes(value.kind))fail('css_attribute_unsupported');
            attr+='='+value.value;
          }
          expect(']');
          items.push(attr+']');
          continue}
        fail('css_selector_unsupported');
      }
      if(!items.length||[',','>','+','~'].includes(items.at(-1)))fail('css_selector');
      return css.slice(start,peek()?.start??css.length).trim()}
    function values(stop,depth=0){
      if(depth>8)fail('css_value_depth');
      const result=[];
      while(peek()&&!stop.includes(peek().value)){
        const t=take();
        if(t.kind==='ident'){
          const name=t.value;
          if(peek()?.value==='('){
            if(!functions.has(name))fail('css_function_unsupported');
            take();
            const args=values([')'],depth+1);
            expect(')');
            if(!args.length)fail('css_function_arguments');
            result.push({
              type:'function',name,args}
            );
          }
          else result.push({
            type:'atom',value:name,start:t.start,end:t.end}
          );
        }
        else if(t.kind==='number'||['#',',','/','+','-','*'].includes(t.value))result.push({
          type:'atom',value:t.value,start:t.start,end:t.end}
        );
        else if(t.value==='!'){
          const n=take();
          if(n?.value!=='important'||!stop.includes(peek()?.value))fail('css_important');
          result.push({
            type:'atom',value:'!important'}
          );
        }
        else fail('css_value_unsupported');
      }
      return result}
    // Legacy accessibility clipping only; not clip-path, masks or resource references.
    function checkClip(property,value){
      const hasRect=items=>items.some(x=>x.type==='function'&&(x.name==='rect'||hasRect(x.args)));
      if(property!=='clip'){
        if(hasRect(value))fail('css_rect_context');
        return;
        }
      if(value.length===1&&value[0].type==='atom'&&['auto','inherit','initial','unset','revert','revert-layer'].includes(value[0].value))return;
      if(value.length!==1||value[0].type!=='function'||value[0].name!=='rect')fail('css_clip_shape');
      const args=value[0].args,parts=[[]];
      for(const a of args){
        if(a.type==='atom'&&a.value===',')parts.push([]);
        else parts.at(-1).push(a);
        }
      if(parts.length!==4)fail('css_clip_shape');
      for(const part of parts){
        if(part.some(x=>x.type!=='atom')||!(part.length===1||part.length===2&&part[0].value==='-'&&part[0].end===part[1].start))fail('css_clip_shape');
        const text=part.map(x=>x.value).join('');
        if(text==='auto')continue;
        if(!/^-?(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|ch))$/.test(text)||Math.abs(parseFloat(text))>100000)fail('css_clip_shape');
        }
    }
    function declarations(){
      const out=[];
      expect('{');
      while(peek()&&peek().value!=='}'){
        const prop=take();
        if(prop?.kind!=='ident'||!properties.has(prop.value)&&!/^--[A-Za-z][A-Za-z0-9-]*$/.test(prop.value))fail('css_property_unsupported');
        expect(':');
        const valueStart=peek()?.start;
        const value=values([';','}']);
        const rawValue=css.slice(valueStart,peek()?.start??css.length).trim();
        if(!value.length)fail('css_empty_value');
        checkClip(prop.value,value);
        out.push({
          type:'declaration',property:prop.value,value,rawValue}
        );
        if(++nodes>3000)fail('css_node_limit');
        if(peek()?.value===';')take();
      }
      expect('}');
      return out}
    function media(){
      let type=null;
      if(peek()?.kind==='ident'&&['screen','all'].includes(peek().value)){
        type=take().value;
        if(peek()?.value==='and')take();
        else if(peek()?.value!=='{')fail('css_media');
      }
      const conditions=[];
      while(peek()?.value==='('){
        take();
        const name=take()?.value;
        expect(':');
        const value=take();
        if(['width','min-width','max-width'].includes(name)){
          if(value?.kind!=='number'||!/^\d+(?:\.\d+)?(?:px|em|rem)$/.test(value.value)||parseFloat(value.value)>10000)fail('css_media_width');
        }
        else if(name==='prefers-reduced-motion'){
          if(!['reduce','no-preference'].includes(value?.value))fail('css_media_motion');
        }
        else fail('css_media_feature');
        expect(')');
        conditions.push({
          name,value:value.value}
        );
        if(peek()?.value==='and'){
          take();
          if(peek()?.value!=='(')fail('css_media');
        }
        else break;
      }
      if(!type&&!conditions.length)fail('css_media');
      return {
        mediaType:type,conditions}
    }
    function rules(depth=0){
      if(depth>4)fail('css_rule_depth');
      const out=[];
      while(peek()&&peek().value!=='}'){
        if(++nodes>3000)fail('css_node_limit');
        if(peek().value==='@'){
          take();
          if(take()?.value!=='media')fail('css_at_rule_unsupported');
          const query=media();
          expect('{');
          const children=rules(depth+1);
          expect('}');
          out.push({
            type:'media',...query,children}
          );
        }
        else{
          const sel=selector();
          out.push({
            type:'rule',selector:sel,declarations:declarations()}
          );
        }
      }
      return out}
    const ast=rules();
    if(pos!==tokens.length)fail('css_unbalanced');
    const serializeValue=list=>list.map(v=>v.type==='function'?v.name+'('+serializeValue(v.args)+')':v.value).join(' ').replace(/#\s+([A-Za-z0-9]+)/g,'#$1');
    const serialize=list=>list.map(n=>n.type==='rule'?n.selector+'{'+n.declarations.map(d=>d.property+':'+d.rawValue).join(';')+'}':'@media '+[n.mediaType,...n.conditions.map(x=>'('+x.name+':'+x.value+')')].filter(Boolean).join(' and ')+'{'+serialize(n.children)+'}').join('\n');
    return {
      supported:true,profile:'css-closed-subset-v2-candidate',ast,css:serialize(ast),execution:'not_run'}
    ;
  }
  catch(error){
    return {
      supported:false,diagnostic:{
        code:error.message}
      ,execution:'not_run'}
  }
}
