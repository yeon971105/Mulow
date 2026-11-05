// ISOLATED CANDIDATE. No runtime authority or production import.
// Exact call-site capability analysis, rejecting unknown values and recursive calls.
const POLICY_ERROR=Symbol('closed-policy-error');
const scalar = primitive => Object.freeze({
  kind:'scalar', primitive}
);
const S=scalar('unknown'), STR=scalar('string'), NUM=scalar('number'), BOOL=scalar('boolean'), NIL=scalar('null');
const E=Object.freeze({
  kind:'element'}
), U=Object.freeze({
  kind:'undefined'}
);
const isScalar=t=>t?.kind==='scalar';
const literalType=value=>value===null?NIL:typeof value==='string'?STR:typeof value==='number'?NUM:typeof value==='boolean'?BOOL:S;
// A state element variable is only a constraint placeholder, never runtime authority.
// Every reachable producer is collected, then a fresh strict pass checks the resolved shape.
function constrain(variable, value) {
  if(variable===value)return true;
  variable.constraints.add(value);
  return true;
}
const forbidden=new Set(['constructor','prototype','__proto__','caller','callee','arguments','call','apply','bind','ref','refs','ownerDocument','defaultView','contentWindow','contentDocument','nativeEvent','currentTarget','innerHTML','outerHTML']);
const hostNames=new Set(['React','createRoot','useState','useMemo','useEffect','Math','Number','parseInt','String','Boolean','Array','Object','JSON','undefined','NaN','Infinity','window','self','globalThis','navigator','location','top','parent','frames','opener','eval','Function','Proxy','Reflect','WebAssembly','Worker','SharedWorker','fetch','XMLHttpRequest','WebSocket','WebTransport','RTCPeerConnection','Image','URL','Blob','document','localStorage','process','require','module','exports']);
const intrinsic=new Set(['div','span','p','h1','h2','h3','h4','header','footer','main','section','article','aside','nav','ul','ol','li','label','input','button','select','option','textarea','strong','small','em','b','i','br','hr','progress','fieldset','legend']);
const attrs=new Set(['data-testid','className','id','key','title','value','checked','disabled','type','placeholder','min','max','step','name','rows','cols','htmlFor','role','tabIndex','maxLength','multiple','inputMode']);
const events=new Set(['onClick','onChange','onInput','onKeyDown']);
const array=element=>({
  kind:'array',element}
),record=fields=>({
  kind:'record',fields}
);
const eventType=record({
  target:record({
    value:STR,checked:BOOL}
  ),key:STR,code:STR,keyCode:NUM,isComposing:BOOL}
);
const data=t=>t&&(isScalar(t)||t===U||t.kind==='stateElement'||t.kind==='maybeUndefined'&&data(t.value)||t.kind==='array'&&data(t.element)||t.kind==='record'&&Object.values(t.fields).every(data));
const renderable=t=>t===E||data(t)||t?.kind==='array'&&renderable(t.element);
const same=(a,b)=>{
  if(a===b)return true;
  if(a?.kind==='stateElement')return constrain(a,b);
  if(b?.kind==='stateElement')return constrain(b,a);
  if(a?.kind!==b?.kind)return false;
  if(isScalar(a))return a.primitive===b.primitive;
  if(a.kind==='array')return same(a.element,b.element);
  if(a.kind==='record')return Object.keys(a.fields).join('|')===Object.keys(b.fields).join('|')&&Object.keys(a.fields).every(k=>same(a.fields[k],b.fields[k]));
  return false;
}
;
const merge=(a,b,n)=>{
  if(same(a,b))return a;
  if(a===U&&data(b))return {
    kind:'maybeUndefined',value:b}
  ;
  if(b===U&&data(a))return {
    kind:'maybeUndefined',value:a}
  ;
  throw Object.assign(Error('ambiguous_value'),{
    [POLICY_ERROR]:'ambiguous_value',node:n}
  );
}
;
class Scope{
  constructor(parent){
    this.parent=parent;
    this.values=new Map()}
  get(k){
    return this.values.has(k)?this.values.get(k):this.parent?.get(k)}
  set(k,v,n){
    if(!k||hostNames.has(k)||forbidden.has(k)||k.startsWith('__mulo')||this.values.has(k))throw Object.assign(Error('unsafe_binding'),{
      [POLICY_ERROR]:'unsafe_binding',node:n}
    );
    this.values.set(k,v)}
}
export const EVENT_ADAPTER=`function __muloWrap(handler){return function(event){const target=Object.freeze({value:typeof event.target?.value==='string'?event.target.value.slice(0,2048):'',checked:event.target?.checked===true});const clean=Object.freeze({target,key:typeof event.key==='string'?event.key.slice(0,32):'',code:typeof event.code==='string'?event.code.slice(0,32):'',keyCode:Number.isInteger(event.keyCode)?event.keyCode:0,isComposing:event.isComposing===true});return handler(clean);};}`;
export function analyzeReactV2(source,parse){
  return analyzePass(source,parse,null);
  }
function analyzePass(source,parse,stateHints){
  const fail=(code,n)=>{
    throw Object.assign(Error(code),{
      [POLICY_ERROR]:code,node:n}
    )}
  ;
  try{
    if(typeof source!=='string'||new TextEncoder().encode(source).length>100000)fail('source_limit');
    let ast;
    try{
      ast=parse(source,{
        ecmaVersion:2022,sourceType:'module',locations:true}
      );
    }
    catch(error){
      fail('source_parse_rejected',{
        loc:{
          start:{
            line:Number.isSafeInteger(error?.loc?.line)&&error.loc.line>0&&error.loc.line<=100000?error.loc.line:null}
        }
      }
      );
    }
    const root=new Scope(),stack=[],edits=[],stateVariables=new Map();
    let nodes=0,calls=0,mounts=0,hasReact=false,hasClient=false,hasCss=false;
    const hooks=new Set(),components=new Set(),visitedFunctions=new Set();
    const safeKey=(key,n)=>{
      if(typeof key!=='string'||forbidden.has(key)||key.startsWith('__mulo'))fail('unsafe_property',n);
      return key}
    ;
    function pattern(p,v,scope){
      if(p.type==='Identifier'){
        scope.set(p.name,v,p);
        return}
      if(p.type==='ObjectPattern'&&v?.kind==='record'){
        for(const prop of p.properties){
          if(prop.type!=='Property'||prop.computed||prop.kind!=='init'||prop.value.type!=='Identifier'||prop.key.type!=='Identifier'||prop.key.name!==prop.value.name)fail('unsupported_destructure',prop);
          const k=safeKey(prop.key.name,prop);
          if(!Object.hasOwn(v.fields,k))fail('unknown_property',prop);
          scope.set(prop.value.name,v.fields[k],prop);
        }
        return}
      fail('unsupported_pattern',p)}
    function fn(n,scope){
      if(n.type==='FunctionExpression'&&n.id)fail('named_function_unsupported',n);
      if(n.async||n.generator||n.params.some(p=>!['Identifier','ObjectPattern'].includes(p.type)))fail('unsupported_function',n);
      return {
        kind:'function',node:n,scope}
    }
    function predeclare(body,scope){
      for(const raw of body){
        const n=raw.type==='ExportDefaultDeclaration'?raw.declaration:raw;
        if(n.type==='FunctionDeclaration'){
          scope.set(n.id.name,fn(n,scope),n);
        }
      }
    }
    function guaranteesReturn(node){
      if(node.type==='ReturnStatement')return true;
      if(node.type==='BlockStatement')return node.body.some(guaranteesReturn);
      if(node.type==='IfStatement')return !!node.alternate&&guaranteesReturn(node.consequent)&&guaranteesReturn(node.alternate);
      return false;
    }
    function invoke(f,args,ctx,n,component=false){
      if(f?.kind!=='function')fail('unknown_callable',n);
      if(++calls>2000||stack.includes(f.node))fail('recursive_or_complex_call',n);
      if(args.some(x=>!x))fail('unknown_argument',n);
      visitedFunctions.add(f.node);
      stack.push(f.node);
      const scope=new Scope(f.scope);
      f.node.params.forEach((p,i)=>pattern(p,args[i]||U,scope));
      let result;
      try{
        result=f.node.body.type==='BlockStatement'?block(f.node.body,scope,{
          ...ctx,component,top:true}
        ):expr(f.node.body,scope,{
          ...ctx,component,top:false}
        );
      }
      finally{
        stack.pop()}
      if(f.node.body.type==='BlockStatement'&&!guaranteesReturn(f.node.body)&&result!==U)result={
        kind:'maybeUndefined',value:result}
      ;
      return result||U}
    function block(n,scope,ctx){
      predeclare(n.body,scope);
      let out=null,mayReturn=false;
      for(const item of n.body){
        const r=stmt(item,scope,{
          ...ctx,top:ctx.top&&!mayReturn}
        );
        if(r){
          out=out?merge(out,r,item):r;
          mayReturn=true;
        }
      }
      return out||U}
    function hook(n,scope,ctx,name){
      if(!ctx.component||!ctx.top||ctx.hookNode!==n)fail('hook_placement',n);
      if(name==='useState'){
        if(n.arguments.length!==1)fail('hook_arguments',n);
        let value=expr(n.arguments[0],scope,{
          ...ctx,top:false}
        );
        if(value.kind==='function')value=invoke(value,[],{
          mode:'memo'}
        ,n);
        if(!data(value))fail('state_must_be_data',n);
        if(value.kind==='array'&&value.element===U){
          if(stateHints){
            const inferred=stateHints.get(n.start);
            if(!inferred)fail('state_shape_unresolved',n);
            value={
              ...array(inferred),inferredState:true}
            ;
            }
          else {
            let variable=stateVariables.get(n.start);
            if(!variable){
              variable={
                kind:'stateElement',constraints:new Set(),node:n}
              ;
              stateVariables.set(n.start,variable);
              }
            value={
              ...array(variable),inferredState:true}
            ;
            }
        }
        return {
          kind:'statepair',value}
      }
      if(!['useMemo','useEffect'].includes(name)||n.arguments.length!==2||n.arguments[1].type!=='ArrayExpression')fail('hook_arguments',n);
      const deps=n.arguments[1].elements.map(item=>{
        if(!item||item.type==='SpreadElement')fail('hook_dependencies',n);
        return expr(item,scope,{
          ...ctx,top:false}
        );
        }
      );
      if(!deps.every(data))fail('hook_dependencies',n);
      const callback=expr(n.arguments[0],scope,{
        ...ctx,top:false}
      );
      const value=invoke(callback,[],{
        mode:name==='useMemo'?'memo':'effect'}
      ,n);
      if(name==='useMemo'){
        if(!data(value))fail('memo_must_be_data',n);
        return value}
      if(value!==U)fail('effect_cleanup_unsupported',n);
      return U;
    }
    function stmt(n,scope,ctx){
      if(++nodes>30000)fail('analysis_limit',n);
      switch(n.type){
        case 'FunctionDeclaration':return null;
        case 'VariableDeclaration':if(n.kind==='var')fail('var_unsupported',n);
        for(const d of n.declarations){
          const value=expr(d.init,scope,{
            ...ctx,hookNode:d.init}
          );
          if(d.id.type==='ArrayPattern'){
            if(value.kind!=='statepair'||d.id.elements.length!==2||d.id.elements.some(x=>x?.type!=='Identifier'))fail('state_binding',d);
            scope.set(d.id.elements[0].name,value.value,d);
            scope.set(d.id.elements[1].name,{
              kind:'setter',value:value.value}
            ,d);
          }
          else pattern(d.id,value,scope);
        }
        return null;
        case 'ReturnStatement':return n.argument?expr(n.argument,scope,{
          ...ctx,top:false}
        ):U;
        case 'ExpressionStatement':expr(n.expression,scope,{
          ...ctx,hookNode:n.expression}
        );
        return null;
        case 'IfStatement':if(!data(expr(n.test,scope,{
          ...ctx,top:false}
        )))fail('condition_data',n);
        const a=stmt(n.consequent,new Scope(scope),{
          ...ctx,top:false}
        ),b=n.alternate?stmt(n.alternate,new Scope(scope),{
          ...ctx,top:false}
        ):null;
        return a&&b?merge(a,b,n):a||b;
        case 'BlockStatement':return block(n,new Scope(scope),{
          ...ctx,top:false}
        );
        case 'EmptyStatement':return null;
        default:fail('unsupported_statement',n)}
    }
    function member(n,scope,ctx){
      const obj=expr(n.object,scope,ctx);
      let key;
      if(n.computed){
        if(n.property.type!=='Literal'||!Number.isSafeInteger(n.property.value)||n.property.value<0||obj.kind!=='array')fail('computed_access',n);
        return {kind:'maybeUndefined',value:obj.element}}
      key=safeKey(n.property.name,n);
      if(obj.kind==='record'){
        if(!Object.hasOwn(obj.fields,key))fail('unknown_property',n);
        return obj.fields[key]}
      if(obj.kind==='array'&&key==='length'||obj===STR&&key==='length')return NUM;
      fail('member_capability',n)}
    function call(n,scope,ctx){
      if(n.optional||n.arguments.some(a=>a.type==='SpreadElement'))fail('call_unsupported',n);
      if(n.callee.type==='Identifier'&&hooks.has(n.callee.name))return hook(n,scope,ctx,n.callee.name);
      if(n.callee.type==='MemberExpression'&&!n.callee.computed&&n.callee.object.type==='Identifier'&&n.callee.object.name==='React'){
        if(!hooks.has('React.'+n.callee.property.name))fail('react_capability',n);
        return hook(n,scope,ctx,n.callee.property.name)}
      const args=()=>n.arguments.map(a=>expr(a,scope,{
        ...ctx,top:false}
      ));
      if(n.callee.type==='Identifier'&&n.callee.name==='parseInt'){if(n.arguments.length!==2||n.arguments[1].type!=='Literal'||n.arguments[1].value!==10)fail('parse_int_radix',n);const value=expr(n.arguments[0],scope,{...ctx,top:false});if(value!==STR&&value!==NUM)fail('parse_int_data',n);return NUM;}
      if(n.callee.type==='Identifier'&&['Number','String','Boolean'].includes(n.callee.name)){
        if(!args().every(data))fail('conversion_data',n);
        return {
          Number:NUM,String:STR,Boolean:BOOL}
        [n.callee.name]}
      if(n.callee.type==='MemberExpression'&&!n.callee.computed&&n.callee.object.type==='Identifier'&&['Math','Number','Array'].includes(n.callee.object.name)){
        const methods={
          Math:['floor','ceil','round','min','max','abs','trunc'],Number:['isFinite','isInteger','isSafeInteger','isNaN'],Array:['isArray']}
        ;
        if(!methods[n.callee.object.name].includes(n.callee.property.name)||!args().every(data))fail('global_method',n);
        return n.callee.object.name==='Math'?NUM:BOOL}
      if(n.callee.type==='MemberExpression'){
        const obj=expr(n.callee.object,scope,{
          ...ctx,top:false}
        );
        if(n.callee.computed)fail('computed_call',n);
        const key=safeKey(n.callee.property.name,n),values=args();
        if(obj.kind==='record'&&Object.hasOwn(obj.fields,key))return invoke(obj.fields[key],values,ctx,n);
        if(obj.kind==='array'){
          if(['map','filter','some','every','find'].includes(key)&&values.length===1){
            const v=invoke(values[0],[obj.element,NUM,obj],ctx,n);
            if(key==='map')return array(v);
            if(!data(v))fail('predicate_data',n);
            return key==='filter'?obj:key==='find'?{kind:'maybeUndefined',value:obj.element}:BOOL}
          if(key==='reduce'&&values.length===2&&data(values[1])){
            const v=invoke(values[0],[values[1],obj.element,NUM,obj],ctx,n);
            if(!data(v))fail('reduce_data',n);
            return merge(v,values[1],n)}
          if(key==='concat'&&values.length){
            for(const value of values){
              const element=value.kind==='array'?value.element:value;
              if(value.kind!=='array'&&!isScalar(value)&&value.kind!=='stateElement')fail('concat_element_unsupported',n);
              if(!same(obj.element,element))fail('array_element_conflict',n);
            }
            return obj;
          }
          if(key==='includes'&&values.every(data))return BOOL;
          fail('array_method',n)}
        if((obj===STR&&['trim','toLowerCase','toUpperCase','slice','includes','startsWith','endsWith'].includes(key)||obj===NUM&&key==='toFixed')&&values.every(data))return ['includes','startsWith','endsWith'].includes(key)?BOOL:STR;
        if(obj.kind==='digitsRegex'&&key==='test'&&values.length===1&&isScalar(values[0]))return BOOL;
        fail('method_capability',n)}
      const f=expr(n.callee,scope,ctx),values=args();
      if(f.kind==='setter'){
        if(!['event','effect'].includes(ctx.mode)||values.length!==1)fail('setter_scope',n);
        let value=values[0];
        if(value.kind==='function'){
          if(f.value.inferredState&&value.node.body.type==='BlockStatement')fail('inferred_updater_requires_expression',n);
          value=invoke(value,[f.value],ctx,n);
          }
        if(!data(value)||!same(value,f.value))fail('setter_data_shape',n);
        return U}
      return invoke(f,values,ctx,n);
    }
    function jsx(n,scope,ctx){
      if(n.type==='JSXText')return;
      if(n.type==='JSXExpressionContainer'){
        if(n.expression.type!=='JSXEmptyExpression'&&!renderable(expr(n.expression,scope,{
          ...ctx,top:false}
        )))fail('render_capability',n);
        return}
      if(n.type==='JSXFragment'){
        n.children.forEach(c=>jsx(c,scope,ctx));
        return}
      if(n.type!=='JSXElement'||n.openingElement.name.type!=='JSXIdentifier')fail('jsx_tag',n);
      const tag=n.openingElement.name.name,props={
      }
      ;
      for(const a of n.openingElement.attributes){
        if(a.type!=='JSXAttribute'||a.name.type!=='JSXIdentifier')fail('jsx_spread',a);
        const key=safeKey(a.name.name,a),v=a.value?.type==='JSXExpressionContainer'?expr(a.value.expression,scope,{
          ...ctx,top:false}
        ):a.value===null?BOOL:a.value.type==='Literal'?literalType(a.value.value):fail('jsx_attribute',a);
        if(intrinsic.has(tag)){
          if(events.has(key)){
            if(v.kind!=='function')fail('event_callable',a);
            const result=invoke(v,[eventType],{
              mode:'event'}
            ,a);
            if(!data(result))fail('event_return',a);
            edits.push({
              start:a.value.expression.start,end:a.value.expression.end}
            );
          }
          else{
            if(!attrs.has(key)&&!/^aria-[a-z-]+$/.test(key)||!data(v))fail('intrinsic_prop',a);
            if(tag==='input'&&key==='type'&&(a.value?.type!=='Literal'||!['text','number','checkbox','radio','range','search'].includes(a.value.value)))fail('input_type',a);
          }
        }
        else{
          if(!data(v)&&v.kind!=='function')fail('component_prop',a);
          props[key]=v;
        }
      }
      if(!intrinsic.has(tag)){
        if(!/^[A-Z][A-Za-z0-9]*$/.test(tag))fail('custom_component_name',n);
        if(n.children.some(c=>c.type!=='JSXText'||c.value.trim()))fail('component_children',n);
        const component=scope.get(tag);
        if(component?.kind!=='function')fail('unknown_component',n);
        components.add(component.node);
        const v=invoke(component,[record(props)],{
          mode:'render'}
        ,n,true);
        if(!renderable(v))fail('component_return',n);
      }
      else n.children.forEach(c=>jsx(c,scope,ctx));
    }
    function expr(n,scope,ctx){
      if(!n)return U;
      if(++nodes>30000)fail('analysis_limit',n);
      if(n.type.startsWith('JSX')){
        jsx(n,scope,ctx);
        return E}
      switch(n.type){
        case 'Identifier':{
          if(['undefined','NaN','Infinity'].includes(n.name))return n.name==='undefined'?U:NUM;
          const v=scope.get(n.name);
          if(!v)fail('unknown_identifier',n);
          return v}
        case 'Literal':if(n.regex){
          if(n.regex.pattern!=='^\\d+$'||n.regex.flags)fail('regex_unsupported',n);
          return {
            kind:'digitsRegex'}
        }
        if(typeof n.value==='bigint')fail('literal_unsupported',n);
        return literalType(n.value);
        case 'ArrowFunctionExpression':case 'FunctionExpression':return fn(n,scope);
        case 'ArrayExpression':{
          let value=U;
          for(const x of n.elements){
            if(!x||x.type==='SpreadElement')fail('array_spread',n);
            const v=expr(x,scope,ctx);
            value=value===U?v:merge(value,v,n)}
          return array(value)}
        case 'ObjectExpression':{
          let fields={
          }
          ;
          for(const p of n.properties){
            if(p.type==='SpreadElement'){
              const v=expr(p.argument,scope,ctx);
              if(v.kind!=='record'||!data(v))fail('spread_nondata',p);
              fields={
                ...fields,...v.fields}
              ;
              continue}
            if(p.type!=='Property'||p.computed||p.kind!=='init'||p.method)fail('object_property',p);
            const k=safeKey(p.key.name??p.key.value,p);
            fields[k]=expr(p.value,scope,ctx);
          }
          if(!Object.values(fields).every(data))fail('record_nondata',n);
          return record(fields)}
        case 'CallExpression':return call(n,scope,ctx);
        case 'MemberExpression':return member(n,scope,ctx);
        case 'BinaryExpression':{
          const left=expr(n.left,scope,ctx),right=expr(n.right,scope,ctx);
          if(!['+','-','*','/','%','<','>','<=','>=','===','!==','==','!='].includes(n.operator)||!data(left)||!data(right))fail('operator_capability',n);
          if(['<','>','<=','>=','===','!==','==','!='].includes(n.operator))return BOOL;
          if(n.operator==='+'&&left===STR&&right===STR)return STR;
          if(left!==NUM||right!==NUM)fail('numeric_operands_required',n);
          return NUM;
        }
        case 'LogicalExpression':{
          const a=expr(n.left,scope,ctx),b=expr(n.right,scope,ctx);
          if(n.operator==='&&'&&data(a)&&(b===E||b.kind==='array'&&b.element===E))return b;
          return merge(a,b,n)}
        case 'ConditionalExpression':if(!data(expr(n.test,scope,ctx)))fail('condition_data',n);
        return merge(expr(n.consequent,scope,ctx),expr(n.alternate,scope,ctx),n);
        case 'UnaryExpression':if(!['!','+','-','typeof','void'].includes(n.operator)||!data(expr(n.argument,scope,ctx)))fail('unary_capability',n);
        return n.operator==='!'?BOOL:n.operator==='typeof'?STR:n.operator==='void'?U:NUM;
        case 'TemplateLiteral':if(!n.expressions.map(x=>expr(x,scope,ctx)).every(data))fail('template_capability',n);
        return STR;
        default:fail('unsupported_expression',n)}
    }
    predeclare(ast.body,root);
    let rootAlias=null;
    function mount(n){
      let x=n;
      if(x.type==='IfStatement'&&rootAlias&&x.test.type==='Identifier'&&x.test.name===rootAlias&&!x.alternate){x=x.consequent;if(x.type==='BlockStatement'&&x.body.length===1)x=x.body[0];}
      if(x.type!=='ExpressionStatement')return false;
      const c=x.expression;
      if(c.type!=='CallExpression'||c.arguments.length!==1||c.callee.type!=='MemberExpression'||c.callee.computed||c.callee.property.name!=='render')return false;
      const create=c.callee.object;
      if(create.type!=='CallExpression'||create.callee.name!=='createRoot'||create.arguments.length!==1)return false;
      const r=create.arguments[0],direct=r.type==='CallExpression'&&r.callee.type==='MemberExpression'&&!r.callee.computed&&r.callee.object.name==='document'&&r.callee.property.name==='getElementById'&&r.arguments.length===1&&r.arguments[0].value==='root';
      if(!direct&&!(r.type==='Identifier'&&r.name===rootAlias))fail('mount_root',r);
      const el=c.arguments[0];
      if(el.type!=='JSXElement'||el.openingElement.name.type!=='JSXIdentifier'||!/^([A-Z][A-Za-z0-9_]*)$/.test(el.openingElement.name.name)||el.openingElement.attributes.length||el.children.length)fail('mount_component',el);
      jsx(el,root,{
        mode:'render'}
      );
      mounts++;
      return true;
    }
    for(const raw of ast.body){
      let n=raw;
      if(n.type==='ImportDeclaration'){
        const name=n.source.value;
        if(name==='react'){
          for(const s of n.specifiers){
            if(s.type==='ImportDefaultSpecifier'&&s.local.name==='React'){
              hasReact=true;
              hooks.add('React.useEffect');
              hooks.add('React.useMemo');
              continue}
            if(s.type!=='ImportSpecifier'||s.local.name!==s.imported.name||!['useState','useMemo','useEffect'].includes(s.local.name))fail('import_unsupported',s);
            hooks.add(s.local.name);
          }
        }
        else if(name==='react-dom/client'){
          if(n.specifiers.length!==1||n.specifiers[0].imported?.name!=='createRoot'||n.specifiers[0].local.name!=='createRoot')fail('import_unsupported',n);
          hasClient=true;
        }
        else if(name!=='./styles.css'||n.specifiers.length)fail('import_unsupported',n);
        else hasCss=true;
        continue}
      if(n.type==='ExportDefaultDeclaration'){
        if(n.declaration.type==='Identifier'&&/^[A-Z][A-Za-z0-9_]*$/.test(n.declaration.name)&&root.get(n.declaration.name)?.kind==='function')continue;
        if(n.declaration.type!=='FunctionDeclaration'||!/^[A-Z][A-Za-z0-9_]*$/.test(n.declaration.id.name))fail('export_unsupported',n);
        n=n.declaration}
      if(n.type==='VariableDeclaration'&&n.declarations.length===1){
        const d=n.declarations[0],v=d.init;
        if(d.id.type==='Identifier'&&v?.type==='CallExpression'&&v.callee.type==='MemberExpression'&&!v.callee.computed&&v.callee.object.name==='document'&&v.callee.property.name==='getElementById'&&v.arguments.length===1&&v.arguments[0].value==='root'){
          if(rootAlias||hostNames.has(d.id.name)||forbidden.has(d.id.name)||d.id.name.startsWith('__mulo'))fail('duplicate_or_unsafe_root',n);
          rootAlias=d.id.name;
          continue}
      }
      if(mount(n))continue;
      stmt(n,root,{
        mode:'module',component:false,top:false}
      );
    }
    if(mounts!==1||!hasReact||!hasClient||!hasCss)fail('mount_required');
    if(!stateHints&&stateVariables.size){
      const resolved=new Map();
      // Bounded fixed point: only exact primitive producers are admitted in this slice.
      for(let round=0;
      round<=stateVariables.size;
      round++){
        let changed=false;
        for(const [id,variable] of stateVariables){
          const kinds=new Set();
          let pending=false;
          for(const value of variable.constraints){
            if(value.kind==='stateElement'){
              const peer=[...stateVariables].find(([,v])=>v===value);
              const known=peer&&resolved.get(peer[0]);
              if(known)kinds.add(known.primitive);
              else pending=true;
            }
            else if(isScalar(value)&&['string','number','boolean'].includes(value.primitive))kinds.add(value.primitive);
            else fail('state_element_unsupported',variable.node);
          }
          if(kinds.size>1)fail('state_element_conflict',variable.node);
          if(!pending&&kinds.size===1&&!resolved.has(id)){
            resolved.set(id,{
              string:STR,number:NUM,boolean:BOOL}
            [[...kinds][0]]);
            changed=true;
            }
        }
        if(!changed)break;
      }
      if(resolved.size!==stateVariables.size)fail('state_shape_unresolved');
      const checked=analyzePass(source,parse,resolved);
      return checked.supported?{
        ...checked,inference:{
          stateCells:resolved.size,phases:['collect_constraints','resolve_exact_primitives','strict_recheck']}
        }
      :checked;
    }

    const unique=[...new Map(edits.map(x=>[x.start+':'+x.end,x])).values()].sort((a,b)=>b.start-a.start);
    for(let i=1;
    i<unique.length;
    i++)if(unique[i].end>unique[i-1].start)fail('overlapping_event_transform');
    let transformed=source;
    for(const x of unique)transformed=transformed.slice(0,x.start)+'__muloWrap('+transformed.slice(x.start,x.end)+')'+transformed.slice(x.end);
    transformed=EVENT_ADAPTER+'\n'+transformed;
    try{
      parse(transformed,{
        ecmaVersion:2022,sourceType:'module'}
      );
    }
    catch{
      fail('transformed_parse_rejected');
    }
    return {
      supported:true,profile:'react-capability-v2-candidate',transformedSource:transformed,eventHandlers:unique.length,components:components.size,execution:'not_run',approval:'not_granted',limitations:['Candidate only; no production authority','No browser CPU/memory guarantee','Event text is capped at 2048 characters; key/code at 32; no native event object is exposed','Only statically proved data/callback flows; unsupported forms fail closed']}
    ;
  }
  catch(error){
    return {
      supported:false,diagnostic:{
        code:error[POLICY_ERROR]||'analysis_unavailable',line:Number.isSafeInteger(error.node?.loc?.start?.line)&&error.node.loc.start.line>0&&error.node.loc.start.line<=100000?error.node.loc.start.line:null}
      ,execution:'not_run',approval:'not_granted'}
  }
}
