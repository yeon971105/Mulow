// A model output envelope, not an executable tool. Local project validation is
// still mandatory: providers can ignore schemas or return malformed arguments.
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'};
const list=items=>({type:'array',items});
export const PROJECT_SUBMISSION_TOOL=Object.freeze({
 type:'function',function:{name:'submit_project_snapshot',description:'Return the complete source snapshot as data. No tool or generated code is executed.',parameters:obj({
  format:{type:'string',enum:['musepilot-project']},version:{type:'integer',enum:[1]},baseRevision:{anyOf:[{type:'string'},{type:'null'}]},complete:{type:'boolean',enum:[true]},
  files:list(obj({path:str,content:str})),entrypoints:list(obj({path:str,purpose:str})),dependencies:list(obj({name:str,version:str,ecosystem:str})),verificationIntents:list(obj({id:str,description:str}))
 })}
});
