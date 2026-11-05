// Transport keepalives are blank NDJSON lines, never activity or saved events.
// A paused workflow can remain silent longer than WebKit's idle read timeout.
export async function pipeRunStream(response,res,{intervalMs=15000,setTimer=setInterval,clearTimer=clearInterval,onClose=()=>{}}={}){
 const reader=response.body.getReader();let closed=false,lineBoundary=true;
 const close=()=>{if(!res.writableFinished){closed=true;void reader.cancel().catch(()=>{});}};
 res.on('close',close);
 const ndjson=response.headers.get('content-type')?.includes('application/x-ndjson');
 const timer=ndjson?setTimer(()=>{if(!closed&&!res.destroyed&&!res.writableEnded&&!res.writableNeedDrain&&lineBoundary)res.write('\n');},intervalMs):null;
 timer?.unref?.();
 try{while(!closed){const {done,value}=await reader.read();if(done)break;if(!value.length)continue;lineBoundary=value[value.length-1]===10;if(!res.write(value))await new Promise(resolve=>{const finish=()=>{res.off('drain',finish);res.off('close',finish);resolve();};res.once('drain',finish);res.once('close',finish);});}}
 finally{if(timer!==null)clearTimer(timer);res.off('close',close);onClose();if(!closed&&!res.writableEnded)res.end();}
}
