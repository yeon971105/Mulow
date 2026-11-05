// Optional model-authored choices; never derive options from question prose.
export function validateClarificationChoices(value,questions){
 if(value===undefined)return undefined;
 const fail=()=>{throw Error('invalid_clarification_choices');};
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
 if(!Array.isArray(value)||value.length>3||!Array.isArray(questions)||questions.length>3)fail();
 const seen=new Set();return value.map(row=>{
  if(!exact(row,['questionIndex','options'])||!Number.isInteger(row.questionIndex)||row.questionIndex<0||row.questionIndex>=questions.length||seen.has(row.questionIndex)||!Array.isArray(row.options)||row.options.length!==2)fail();seen.add(row.questionIndex);
  const labels=new Set(),ids=new Set();const options=row.options.map(option=>{if(!exact(option,['id','label'])||!['1','2'].includes(option.id)||ids.has(option.id)||typeof option.label!=='string'||!option.label.trim()||option.label.length>240||labels.has(option.label.trim()))fail();ids.add(option.id);labels.add(option.label.trim());return{id:option.id,label:option.label.trim()};});
  return{questionIndex:row.questionIndex,options};
 });
}
export function clarificationChoiceFields(value){const choices=validateClarificationChoices(value?.clarificationChoices,value?.clarificationQuestions||[]);return choices===undefined?{}:{clarificationChoices:choices};}
