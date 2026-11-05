import {planningSources,inputRevision,buildPlanningContext} from './planning-intake.js';
export function firstPlanInputBinding(s,prompt){return JSON.stringify([s.id,s.model,inputRevision(s),String(prompt).trim()]);}
export function needsFirstPlanInputReview(s,context){return s.chatMode==='plan'&&!s.pendingPlan&&planningSources(s).length>0&&!(context?.consent===true&&context.sources?.length);}
export function firstPlanInputBypassCurrent(bypass,s,prompt){return !!bypass&&!bypass.used&&bypass.binding===firstPlanInputBinding(s,prompt);}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createPlanningReview(s,ids=[]){return {sessionId:s.id,model:s.model,sourceRevision:inputRevision(s),ids:[...ids],context:ids.length?buildPlanningContext(s,ids,true):null,approved:false};}
export function planningReviewCurrent(review,s){return !!review&&review.sessionId===s.id&&review.model===s.model&&review.sourceRevision===inputRevision(s);}
export function planningReviewContext(review,s,attachments=null){
 if(!review||review.sessionId!==s.id)return attachments;
 if(!review.ids.length)return attachments;
 if(!planningReviewCurrent(review,s))throw Error('Planning inputs or model changed. Review the current excerpts again.');
 if(!review.approved)throw Error('Review and check the planning excerpts before sending, or close the input selection.');
 if(s.chatMode==='agent')throw Error('Planning excerpts are available in Plan or Ask. Agent uses the approved blueprint.');
 const current=buildPlanningContext(s,review.ids,true);
 if(JSON.stringify(current)!==JSON.stringify(review.context))throw Error('Planning excerpts changed. Review again.');
 const context=attachments?{consent:true,sourceRevision:current.sourceRevision,sources:[...current.sources,...attachments.sources]}:current;
 if(attachments&&attachments.sourceRevision!==current.sourceRevision)throw Error('Attachment inputs changed. Review again.');
 if(context.sources.length>10||new TextEncoder().encode(JSON.stringify(context)).length>4500)throw Error('Select fewer planning or attachment excerpts. The combined context limit is 4.5 KB and ten sources.');
 return context;
}
export function renderPlanningReview(review,s){
 if(!review||review.sessionId!==s.id)return '';
 const valid=planningReviewCurrent(review,s),sources=planningSources(s),provider=s.model==='spark'?'Muse Spark (Baseten)':s.model==='nebius'?'Nemotron 3.5 Lightning (Nebius)':String(s.model||'selected model');
 return `<section class="planning-input-review" aria-label="Planning context"><header><strong>Plan with your inputs</strong><button type="button" data-action="close-planning-inputs" aria-label="Close planning context">×</button></header><small>Select sources for your next message. Originals stay local.</small><div class="planning-source-options">${sources.map(r=>`<label><input type="checkbox" data-planning-source="${esc(r.id)}" ${review.ids.includes(r.id)?'checked':''}>${esc(r.name)}</label>`).join('')||'<small>No readable sources available.</small>'}</div>${!valid?'<p role="status">Inputs or model changed. Reselect sources to review the current text.</p>':''}${review.context&&valid?`<details class="planning-excerpts"><summary>Exact outgoing text · ${review.context.sources.length} source(s)</summary>${review.context.sources.map(r=>`<strong>${esc(r.name)}</strong><pre>${esc(r.text)}</pre><small>${r.truncated?'Partial excerpt. Remaining text is omitted.':'Complete retained text.'}</small>`).join('')}</details><label class="planning-consent"><input type="checkbox" data-planning-consent ${review.approved?'checked':''}>Include these excerpts with my next message to ${esc(provider)}</label>`:''}${review.firstPlanGuard?'<button type="button" data-action="planning-without-inputs">Continue without inputs</button>':''}<small>No request starts here. Write your instruction below, then Send.</small></section>`;
}
