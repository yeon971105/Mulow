// Questions and choices come only from the current saved Muse document.
export function documentQuestionKey(view){const c=view?.current;return view?.sessionId&&c?.revisionId&&c?.documentDigest?JSON.stringify([view.sessionId,c.revisionId,c.documentDigest]):null;}
export function documentQuestions(view){return [...new Set((view?.current?.knownQuestions||[]).filter(q=>typeof q==='string'&&q.trim()))];}
export function documentQuestionChoices(question){
 const markers=[...question.matchAll(/\bOption\s+([A-Z])\s*[:.)-]?\s*/gi)];
 if(markers.length>=2&&markers.length<=5)return markers.map((m,i)=>{const end=markers[i+1]?.index??question.length,label=question.slice(m.index+m[0].length,end).replace(/\s*(?:[,;]\s*)?\bor\s*$/i,'').replace(/[?;,.\s]+$/,'').trim();return {label,value:'Option '+m[1].toUpperCase()+': '+label};}).filter(x=>x.label);
 const native=/no new package\s*\(stay React-only\)/i.exec(question);return native?[{label:native[0],value:native[0]}]:[];
}
export function documentQuestionAnswer(view,key,questionIndex,choiceIndex){
 if(key!==documentQuestionKey(view)||view.busy||view.editing)return null;
 const question=documentQuestions(view)[questionIndex],choice=question&&documentQuestionChoices(question)[choiceIndex];
 return choice?question+'\nSelected: '+choice.value:null;
}
export function appendDocumentAnswer(draft,answer){if(typeof answer!=='string'||!answer)return null;const value=String(draft||'');if(value.includes(answer))return value;const next=value.trim()?value+'\n\n'+answer:answer;return next.length<=6000?next:null;}
export function renderDocumentQuestions(view,esc,draft=''){
 const key=documentQuestionKey(view),questions=documentQuestions(view);if(!key||!questions.length)return '';
 return '<div class="muse-document-questions" data-document-question-key="'+esc(key)+'">'+questions.map((q,i)=>'<div class="muse-document-question"><p>'+esc(q)+'</p><div class="muse-question-options">'+documentQuestionChoices(q).map((choice,j)=>{const selected=draft.includes(q+'\nSelected: '+choice.value);return '<button type="button" data-document-choice="'+i+'" data-document-option="'+j+'" aria-pressed="'+selected+'" '+(view.busy||view.editing?'disabled':'')+'>'+esc(choice.label)+'</button>';}).join('')+'</div></div>').join('')+'</div>';
}
export function documentReplyAnswer(view,key,index,reply){
 if(key!==documentQuestionKey(view)||view.busy||view.editing)return null;
 const question=documentQuestions(view)[index];if(!question)return null;
 if(reply?.kind==='custom'){const text=typeof reply.text==='string'?reply.text.trim():'';return text&&text.length<=2000?question+'\nAnswer: '+text:null;}
 return reply?.kind==='choice'?documentQuestionAnswer(view,key,index,reply.index):null;
}
export function documentReplyText(view,key,replies={}){const answers=documentQuestions(view).map((q,i)=>documentReplyAnswer(view,key,i,replies[i]));return answers.length&&answers.every(Boolean)?answers.join('\n\n'):null;}
export function compactQuestionLabel(question){const i=question.search(/\bOption\s+[A-Z]/i);return (i>0?question.slice(0,i):question).replace(/\s*using literal labels\s*:?\s*$/i,'').replace(/[:?\s]+$/,'').trim()||'Choose an option';}
export function renderNumberedDocumentQuestions(view,esc,replies={}){
 const key=documentQuestionKey(view),questions=documentQuestions(view);if(!key||!questions.length)return '';
 return '<section class="muse-document-questions muse-numbered-questions" aria-label="Muse questions" data-document-question-key="'+esc(key)+'">'+questions.map((q,i)=>{const choices=documentQuestionChoices(q),reply=replies[i];return '<div class="muse-document-question" data-question-index="'+i+'"><p title="'+esc(q)+'">'+esc(compactQuestionLabel(q))+'</p><div class="muse-question-options">'+choices.map((choice,j)=>'<button type="button" data-document-choice="'+i+'" data-document-option="'+j+'" aria-pressed="'+(reply?.kind==='choice'&&reply.index===j)+'" '+(view.busy||view.editing?'disabled':'')+'><span class="question-option-number" aria-hidden="true">'+(j+1)+'</span><span>'+esc(choice.label)+'</span></button>').join('')+'</div><label class="question-custom-row"><span class="question-option-number" aria-hidden="true">'+(choices.length+1)+'</span><input type="text" maxlength="2000" data-document-custom="'+i+'" aria-label="Your answer: '+esc(compactQuestionLabel(q))+'" placeholder="Write your answer…" value="'+esc(reply?.kind==='custom'?reply.text:'')+'" '+(view.busy||view.editing?'disabled':'')+'></label></div>';}).join('')+'<button type="button" class="question-continue" data-document-continue '+(documentReplyText(view,key,replies)?'':'disabled')+'>Continue</button></section>';
}
