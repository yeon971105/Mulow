// Parse a complete model response without extracting a JSON-looking substring.
// A single enclosing Markdown JSON fence is the only accepted wrapper. Project
// tool arguments must remain plain JSON. Schema validation remains separate.
export function parseModelJsonContent(content,{allowFence=true}={}){
 const text=content.trim();
 try{return {value:JSON.parse(text),envelope:'json'};}catch{}
 const fence=allowFence&&text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
 if(fence){try{return {value:JSON.parse(fence[1]),envelope:'fenced_json'};}catch{}}
 const error=Error('model_output_not_json');
 error.field=!text?'model_response_empty':!allowFence?'tool_arguments_invalid_json':fence?'model_response_fenced_invalid':text.startsWith('```')?'model_response_unsafe_wrapper':'model_response_invalid_json';
 throw error;
}
