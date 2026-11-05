// Trusted, data-only compartment helpers. Never install in the privileged parent realm.
export const REACT_PERSISTENT_DATA_LIMITS=Object.freeze({depth:24,nodes:20000,collection:2000,string:65536,entryFuel:100000,lifetimeFuel:5000000});
export function createReactPersistentDataRuntime({isActive=()=>true,onFailure=()=>{}}={}) {
  const L=REACT_PERSISTENT_DATA_LIMITS, blocked=new Set(['__proto__','prototype','constructor','caller','callee','arguments','call','apply','bind']);
  let fuel=L.entryFuel,total=L.lifetimeFuel,depth=0,failed=false;
  function deny(code){failed=true;onFailure(code);throw new Error(code);}
  function step(n=1){if(failed||!isActive())throw new Error('preview_inactive');if(!Number.isSafeInteger(n)||n<0||(total-=n)<0||(fuel-=n)<0)deny('data_fuel_exhausted');}
  function key(k){if(typeof k==='number'&&Number.isSafeInteger(k)&&k>=0)k=String(k);if(typeof k!=='string'||k.length>128||blocked.has(k)||k.startsWith('__mulo'))deny('data_key_rejected');return k;}
  function primitive(v){if(v===null||v===undefined||typeof v==='boolean'||typeof v==='string'&&v.length<=L.string||typeof v==='number')return v;deny('data_primitive_required');}
  function inspect(v,{allowUndefined=true}={},seen=new Set(),d=0,budget={n:0}){
    step();if(++budget.n>L.nodes||d>L.depth)deny('data_size_limit');
    if(v===undefined){if(!allowUndefined)deny('data_undefined');return v;}
    if(!allowUndefined&&typeof v==='number'&&!Number.isFinite(v))deny('data_json_number');if(v===null||typeof v!=='object')return primitive(v);
    if(seen.has(v))deny('data_cycle');
    const proto=Object.getPrototypeOf(v);if(proto!==Object.prototype&&proto!==null&&proto!==Array.prototype)deny('data_prototype');
    if(Array.isArray(v)&&v.length>L.collection)deny('data_collection_limit');
    const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);if(names.length>L.collection+1)deny('data_collection_limit');seen.add(v);
    for(const name of names){if(typeof name!=='string')deny('data_symbol');if(Array.isArray(v)&&name==='length')continue;key(name);const desc=descriptors[name];if(!Object.hasOwn(desc,'value'))deny('data_accessor');inspect(desc.value,{allowUndefined},seen,d+1,budget);}
    seen.delete(v);return v;
  }
  function get(o,k,optional=false){step();k=key(k);if(o==null){if(optional)return undefined;throw new TypeError('data_null_read');}if(typeof o==='string'){primitive(o);if(k==='length')return o.length;if(/^(0|[1-9][0-9]*)$/.test(k))return o[Number(k)];deny('data_property');}inspect(o);if(typeof o!=='object')deny('data_property');const d=Object.getOwnPropertyDescriptor(o,k);if(!d)return undefined;if(!Object.hasOwn(d,'value'))deny('data_accessor');return inspect(d.value);}
  function set(o,k,v,op='='){step();inspect(o);inspect(v);if(!o||typeof o!=='object'||Object.isFrozen(o))deny('data_write_rejected');k=key(k);if(Array.isArray(o)&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=L.collection))deny('data_array_write');const old=Object.getOwnPropertyDescriptor(o,k);if(old&&!Object.hasOwn(old,'value'))deny('data_accessor');if(!old&&Object.keys(o).length>=L.collection)deny('data_collection_limit');const next=op==='='?v:binary(op.slice(0,-1),old?.value,v);Object.defineProperty(o,k,{value:next,writable:true,enumerable:true,configurable:true});return next;}
  function update(o,k,callback,op){step();if(typeof callback!=='function'||!['+=','-='].includes(op))deny('data_update');const before=get(o,k);const value=callback();return set(o,k,binary(op[0],before,value));}
  function convert(name,v){step();primitive(v);if(name==='Number'){return Number(v);}if(name==='String'){const s=String(v);if(s.length>L.string)deny('data_string_limit');return s;}if(name==='Boolean')return Boolean(v);deny('data_conversion');}
  function binary(op,a,b){step();if(['===','!=='].includes(op))return op==='==='?a===b:a!==b;primitive(a);primitive(b);let r;switch(op){case '+':r=a+b;break;case '-':r=a-b;break;case '*':r=a*b;break;case '/':r=a/b;break;case '%':r=a%b;break;case '<':return a<b;case '>':return a>b;case '<=':return a<=b;case '>=':return a>=b;case '==':return a==b;case '!=':return a!=b;default:deny('data_operator');}return primitive(r);}
  function unary(op,v){step();if(op==='!')return !v;if(op==='void')return undefined;if(op==='typeof')return typeof v;primitive(v);return primitive(op==='+'?+v:op==='-'?-v:deny('data_operator'));}
  function array(parts){step();const out=[];for(const [spread,v] of parts){inspect(v);if(spread){if(!Array.isArray(v))deny('data_array_required');out.push(...v);}else out.push(v);if(out.length>L.collection)deny('data_collection_limit');}return out;}
  function object(parts){step();const out={};for(const [spread,k,v] of parts){if(spread){inspect(k);if(!k||typeof k!=='object'||Array.isArray(k))deny('data_record_required');for(const name of Object.keys(k))set(out,name,get(k,name));}else set(out,k,v);}return out;}
  function call(o,method,args,renderResult=false){step();inspect(o);const callbacks=new Set(['map','filter','some','every','find','forEach','sort','reduce']);if(Array.isArray(o)){
      if(callbacks.has(method)){const fn=args[0];if(typeof fn!=='function'||args.length!==(method==='reduce'?2:1))deny('data_callback');const wrapped=(...values)=>{step();const result=fn(...values);if(!(renderResult&&method==='map'))inspect(result);return result;};let result;if(method==='sort'){result=o.sort((a,b)=>{const r=wrapped(a,b);if(typeof r!=='number'||!Number.isFinite(r))deny('data_comparator');return r;});}else if(method==='reduce'){inspect(args[1]);result=o.reduce(wrapped,args[1]);}else result=Array.prototype[method].call(o,wrapped);if(Array.isArray(result)&&result.length>L.collection)deny('data_collection_limit');return result;}
      args.forEach(v=>inspect(v));if(method==='includes'&&args.length===1)return o.includes(args[0]);if(method==='concat'){let size=o.length;for(const value of args){size+=Array.isArray(value)?value.length:1;if(size>L.collection)deny('data_collection_limit');}const r=o.concat(...args);inspect(r);return r;}deny('data_array_method');
    }
    args.forEach(primitive);if(typeof o==='string'&&['trim','toLowerCase','toUpperCase','slice','includes','startsWith','endsWith','localeCompare'].includes(method)){if(args.length>2)deny('data_arguments');return primitive(String.prototype[method].apply(o,args));}if(typeof o==='number'&&['toFixed','toString'].includes(method)){if(args.length>1||args.length&&(!Number.isInteger(args[0])||args[0]<0||args[0]>36))deny('data_number_format');return primitive(Number.prototype[method].apply(o,args));}deny('data_method');
  }
  function parse(s){step();if(typeof s!=='string'||s.length>L.string)deny('data_json_input');let v;try{v=JSON.parse(s)}catch{deny('data_json_invalid')}return inspect(v,{allowUndefined:false});}
  function stringify(v){step();inspect(v,{allowUndefined:false});const s=JSON.stringify(v);if(typeof s!=='string'||s.length>L.string)deny('data_json_size');return s;}
  function style(v){step();inspect(v);if(!v||Array.isArray(v)||typeof v!=='object')deny('style_record');const out={};for(const k of Object.keys(v)){if(!['background','backgroundColor','borderTopColor','borderLeftColor','color'].includes(k))deny('style_property');const value=get(v,k);if(typeof value!=='string'||!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value))deny('style_color');out[k]=value;}return Object.freeze(out);}
  function child(v){step();if(Array.isArray(v)){if(v.length>L.collection)deny('render_collection');return v.map(child);}if(v===null||v===undefined||typeof v==='boolean'||typeof v==='string'||typeof v==='number')return primitive(v);deny('render_data_object');}
  return Object.freeze({
    enter(){if(depth++===0)fuel=L.entryFuel;step();},leave(){depth=Math.max(0,depth-1);},isFailed:()=>failed,
    __muloDataFailure:deny,__muloStep:step,__muloGet:get,__muloSet:set,__muloUpdate:update,__muloDataCall:call,__muloArray:array,__muloObject:object,__muloConvert:convert,__muloBinary:binary,__muloUnary:unary,__muloJsonParse:parse,__muloJsonStringify:stringify,__muloStyle:style,__muloChild:child,
    __muloGlobal(group,name,args){step();if(args.length>32)deny('data_arguments');if(group==='Array'&&name==='isArray'){if(args.length!==1)deny('data_arguments');inspect(args[0]);return Array.isArray(args[0]);}args.forEach(primitive);const methods={Math:['floor','ceil','round','min','max','abs','trunc'],Number:['isFinite','isInteger','isSafeInteger','isNaN'],Array:['isArray']};if(!methods[group]?.includes(name))deny('data_global');return primitive(({Math,Number,Array})[group][name](...args));},
    __muloKeys(v){step();inspect(v);if(!v||typeof v!=='object')deny('data_record_required');return Object.keys(v);},
    __muloTemplate(parts,values){step();let out='';for(let i=0;i<parts.length;i++){step();const p=parts[i],v=i<values.length?String(primitive(values[i])):'';if(typeof p!=='string'||out.length+p.length+v.length>L.string)deny('data_string_limit');out+=p+v;}return out;},
    __muloProp(v){step();return primitive(v);},
    __muloCheckData(v){step();return inspect(v);}
  });
}
