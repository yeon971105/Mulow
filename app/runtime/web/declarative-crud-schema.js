export const CRUD_PROFILE='trusted-declarative-crud-v1';
export const CRUD_LIMITS=Object.freeze({schemaBytes:65536,collections:4,fields:16,textLength:2000,enumValues:20,requestBytes:32768,page:100,records:10000,dataBytes:10485760,integerMagnitude:1000000000});
const fail=k=>{throw Error('crud_'+k+'_invalid');};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const closed=(v,keys,k)=>{if(!object(v)||Object.keys(v).some(x=>!keys.includes(x)))fail(k);};
const text=(v,max=160)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const reserved=new Set(['id','version','sequence','__proto__','prototype','constructor','dataset_id','project_id','session_id','owner']);
const id=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(v)&&!reserved.has(v);
const integer=v=>Number.isSafeInteger(v)&&Math.abs(v)<=1000000000;
export function validateCrudSchema(raw){
 closed(raw,['format','version','title','collections'],'schema');if(raw.format!=='mulow-declarative-crud'||raw.version!==1||!text(raw.title)||!Array.isArray(raw.collections)||!raw.collections.length||raw.collections.length>4)fail('schema');
 const collections=raw.collections.map(c=>{closed(c,['id','label','fields'],'schema');if(!id(c.id)||!text(c.label)||!Array.isArray(c.fields)||!c.fields.length||c.fields.length>16)fail('schema');
 const fields=c.fields.map(f=>{closed(f,['id','label','type','required','maxLength','min','max','values'],'schema');if(!id(f.id)||!text(f.label)||!['text','integer','boolean','enum'].includes(f.type)||typeof f.required!=='boolean')fail('schema');const base={id:f.id,label:f.label,type:f.type,required:f.required};
 if(f.type==='text'){if(Object.hasOwn(f,'min')||Object.hasOwn(f,'max')||Object.hasOwn(f,'values')||!Number.isSafeInteger(f.maxLength)||f.maxLength<1||f.maxLength>2000)fail('schema');return {...base,maxLength:f.maxLength};}
 if(f.type==='integer'){if(Object.hasOwn(f,'maxLength')||Object.hasOwn(f,'values')||!integer(f.min)||!integer(f.max)||f.min>f.max)fail('schema');return {...base,min:f.min,max:f.max};}
 if(f.type==='enum'){if(Object.hasOwn(f,'maxLength')||Object.hasOwn(f,'min')||Object.hasOwn(f,'max')||!Array.isArray(f.values)||!f.values.length||f.values.length>20||f.values.some(v=>!text(v,120))||new Set(f.values).size!==f.values.length)fail('schema');return {...base,values:[...f.values]};}
 if(['maxLength','min','max','values'].some(k=>Object.hasOwn(f,k)))fail('schema');return base;
 });if(new Set(fields.map(f=>f.id)).size!==fields.length)fail('schema');return {id:c.id,label:c.label,fields};});
 if(new Set(collections.map(c=>c.id)).size!==collections.length)fail('schema');const result={format:raw.format,version:1,title:raw.title,collections};if(new TextEncoder().encode(JSON.stringify(result)).byteLength>65536)fail('schema');return result;
}
export function validateCrudValues(collection,raw){
 closed(raw,collection.fields.map(f=>f.id),'values');const result={};for(const f of collection.fields){const v=Object.hasOwn(raw,f.id)?raw[f.id]:null;if(v===null){if(f.required)fail('values');result[f.id]=null;continue;}
 if(f.type==='text'&&(typeof v!=='string'||v.length>f.maxLength||f.required&&!v.trim()||/[\u0000]/.test(v))||f.type==='integer'&&(!Number.isSafeInteger(v)||v<f.min||v>f.max)||f.type==='boolean'&&typeof v!=='boolean'||f.type==='enum'&&!f.values.includes(v))fail('values');result[f.id]=v;
 }return result;
}
