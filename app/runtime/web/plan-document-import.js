import {readPlanDocumentFile} from './plan-document-controller.js';
import {planDocumentViewKey} from './plan-document-view.js';

// Initial Plan import only. A saved document is continued or edited, never replaced here.
export function createPlanDocumentImport({getState,importFile,onChange=()=>{}}){
 let pickerKey=null,error=null,ticket=0;
 const eligible=s=>s.phase==='ready'&&!s.current&&!s.busy&&!s.blocked&&!s.editing;
 const binding=()=>planDocumentViewKey(getState());
 function cancel(){pickerKey=null;error=null;ticket++;}
 return {
  state(){if(error&&error.key!==binding())error=null;return error?{error:error.message}:null;},
  begin(){const s=getState();if(!eligible(s))return false;cancel();pickerKey=planDocumentViewKey(s);return true;},
  cancel,
  async choose(file){const key=pickerKey;pickerKey=null;if(!key||key!==binding()||!eligible(getState()))return false;const own=++ticket;
   try{const data=await readPlanDocumentFile(file);if(own!==ticket||key!==binding()||!eligible(getState()))return false;
    // Preserve validated UTF-8 bytes, including BOM and line endings, without a mutable reread.
    const bytes=new TextEncoder().encode(data.rawText),snapshot={name:data.filename,size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer};
    return await importFile(snapshot);
   }catch(e){if(own===ticket&&key===binding()){error={key,message:['Choose a UTF-8 .md or .txt file up to 48 KiB.','The selected file changed. Choose it again.','Only valid UTF-8 text is supported.','Choose a nonempty plain-text plan.'].includes(e.message)?e.message:'The file could not be read. Nothing was imported.'};onChange();}return false;}
  }
 };
}
