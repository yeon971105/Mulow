// Mozilla PDF.js assets are pinned and same-origin. No document upload or scripting.
export async function extractPdfText(file,{pdfjs=null,timeoutMs=20000,maxPages=100,maxChars=1_000_000}={}){
 const engine=pdfjs||await import('./vendor/pdfjs/pdf.mjs');
 if(!pdfjs)engine.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
 const task=engine.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,useWasm:false,disableFontFace:true,enableXfa:false,stopAtErrors:true});
 let timer;
 try{return await Promise.race([(async()=>{const pdf=await task.promise;if(pdf.numPages>maxPages)throw Error('PDF exceeds '+maxPages+' page limit.');let text='';for(let number=1;number<=pdf.numPages;number++){const page=await pdf.getPage(number);try{const content=await page.getTextContent();text+='\n\n[Page '+number+']\n'+content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('');if(text.length>maxChars)throw Error('PDF text exceeds 1 MB extraction limit.');}finally{page.cleanup();}}return {text,pages:pdf.numPages};})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PDF extraction timed out.')),timeoutMs);})]);}
 finally{clearTimeout(timer);await task.destroy();}
}
