// Web Speech API: audio is never stored here; text is emitted for editing, never sent.
// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static
export function createVoiceInput({
 getSessionId, onTranscript=()=>{}, onStatus=()=>{}, onError=()=>{},
 confirmRemote=async()=>false,
 SpeechRecognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition,
 language=globalThis.navigator?.language||'en-US',
 timers={setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)},
 checkingTimeoutMs=15000, stoppingTimeoutMs=3000
}) {
 let generation=0, recognition=null, sessionId=getSessionId(),watchdog=null,pendingCheckCancel=null;
 const clearWatchdog=()=>{if(watchdog!==null){timers.clearTimeout(watchdog);watchdog=null;}};
 function armWatchdog(ms,message){clearWatchdog();const ticket=generation;watchdog=timers.setTimeout(()=>{watchdog=null;if(ticket!==generation)return;if(getSessionId()!==sessionId){cancel();return;}cancel();onError(message);},ms);}
 let snapshot={status:typeof SpeechRecognition==='function'?'idle':'unsupported',local:null,sessionId};
 const publish=(status,local=snapshot.local)=>{snapshot={status,local,sessionId};onStatus({...snapshot});};
 const abort=(engine)=>{try{engine?.abort();}catch{/* Already ended or never started. */}};
 function cancel(){clearWatchdog();generation++;const release=pendingCheckCancel;pendingCheckCancel=null;release?.();const old=recognition;recognition=null;sessionId=getSessionId();publish(typeof SpeechRecognition==='function'?'idle':'unsupported',null);abort(old);}
 function sync(){if(getSessionId()!==sessionId)cancel();}
 async function toggle(){
  sync();
  if(snapshot.status==='unsupported'){onError('Voice input is unavailable in this browser. Type your message instead.');return;}
  if(snapshot.status==='listening'){
   publish('stopping');armWatchdog(stoppingTimeoutMs,'Voice input did not finish stopping. Capture was cancelled; your message was not sent.');
   try{recognition.stop();}catch(e){cancel();onError('Could not stop voice input: '+(e.message||'unknown error'));}
   return;
  }
  if(snapshot.status!=='idle'){cancel();return;}
  const ticket=++generation,id=sessionId;
  const valid=()=>ticket===generation&&getSessionId()===id;
  const current=()=>{if(getSessionId()!==sessionId)sync();return valid();};
  let engine;
  try {
   engine=new SpeechRecognition();recognition=engine;
   engine.lang=language;engine.continuous=true;engine.interimResults=false;engine.maxAlternatives=1;
   publish('checking',null);
   let local=false;
   if('processLocally' in engine&&typeof SpeechRecognition.available==='function'){
    armWatchdog(checkingTimeoutMs,'Voice availability check timed out. No recording was started.');
    const available=await Promise.race([SpeechRecognition.available({langs:[language],processLocally:true}),new Promise(resolve=>{pendingCheckCancel=()=>resolve(null);})]);
    if(!current())return;
    clearWatchdog();pendingCheckCancel=null;
    local=available==='available';
   }
   if(local){
    engine.processLocally=true;
    if(engine.processLocally!==true)throw Error('The browser could not guarantee on-device recognition.');
   }else{
    publish('consent',false);
    const approved=await confirmRemote({language,sessionId:id,message:'This browser may send microphone audio to its speech recognition provider. Mulo does not store audio. Continue with browser speech recognition?'});
    if(!current())return;
    if(approved!==true){cancel();return;}
    if('processLocally' in engine)engine.processLocally=false;
   }
   if(!current())return;
   const delivered=new Set();
   engine.onstart=()=>{if(current()){clearWatchdog();publish('listening',local);}};
   engine.onresult=event=>{
    if(!current())return;
    for(let i=event.resultIndex||0;i<event.results.length;i++){
     const result=event.results[i];
     if(!result.isFinal||delivered.has(i))continue;
     delivered.add(i);const text=result[0]?.transcript?.trim();
     if(text)onTranscript(text,id);
    }
   };
   engine.onerror=event=>{
    if(!current())return;
    const code=event.error||'unknown';cancel();
    onError(code==='not-allowed'||code==='service-not-allowed'?'Microphone or speech recognition permission was denied. Nothing was sent as a chat message.':`Voice input stopped (${code}). Your message was not sent.`);
   };
   engine.onend=()=>{if(current()){clearWatchdog();generation++;recognition=null;publish('idle',null);}};
   publish('checking',local);armWatchdog(checkingTimeoutMs,'Voice input did not start in time. Microphone capture was cancelled.');engine.start();
  }catch(e){if(current()){cancel();onError('Voice input unavailable: '+(e.message||'unknown error'));}}
 }
 return {toggle,cancel,sync,state:()=>({...snapshot})};
}
