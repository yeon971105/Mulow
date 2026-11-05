import {newSession} from './model.js';
import {inputRevision} from './planning-intake.js';
import {sensitiveImport} from './import-analysis.js';
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
export function prepareMessageEdit(source,index){
 const m=source.messages?.[index];if(!Number.isInteger(index)||!m||m.role!=='user'||typeof m.text!=='string')throw Error('Only your own text messages can be edited.');
 const earlier=source.messages.slice(0,index).filter(x=>['user','assistant'].includes(x.role)&&x.kind!=='welcome'&&typeof x.text==='string');
 let history=earlier.map(x=>(x.role==='user'?'You':'Muse')+': '+x.text).join('\n\n'),truncated=false;
 while(bytes(history)>1800){history=history.slice(0,Math.floor(history.length*.8));truncated=true;}
 const sensitive=sensitiveImport(history);return {kind:'message-edit',sessionId:source.id,index,messageId:m.id||null,originalText:m.text,prefix:JSON.stringify(source.messages.slice(0,index).map(x=>[x.role,x.text])),model:source.model,text:m.text,history:sensitive?'':history,historyBlocked:sensitive,truncated,includeHistory:false};
}
export function messageEditCurrent(edit,source){const m=source?.messages?.[edit?.index];return edit?.sessionId===source?.id&&edit.model===source.model&&m?.role==='user'&&(m.id||null)===edit.messageId&&m.text===edit.originalText&&JSON.stringify(source.messages.slice(0,edit.index).map(x=>[x.role,x.text]))===edit.prefix;}
export function createMessageBranch(source,edit,text,includeHistory){
 if(!messageEditCurrent(edit,source))throw Error('The original message or model changed. Open Edit again.');
 if(typeof text!=='string'||!text.trim()||text.length>6000)throw Error('Enter a revised message of up to 6000 characters.');
 const s=newSession((source.title.slice(0,48)||'Session')+' · edited branch');s.model=source.model;s.chatMode='plan';s.projectId=source.projectId||null;s.projectAssignment={source:'explicit_message_branch',projectId:s.projectId};
 s.branchOf={sessionId:source.id,messageId:edit.messageId,messageIndex:edit.index};
 // Display-only conversation history. No workflow, approval, artifact, source or active-run state is inherited.
 s.messages=source.messages.slice(0,edit.index).map(m=>({role:m.role,text:m.text,kind:'branch-history',historical:true}));
 s.messages.push({role:'assistant',kind:'branch-notice',text:'New branch from an edited message. Earlier messages are displayed for reference only. Original work is unchanged; files, execution and approvals are not copied. A new plan needs review.'});
 const context=includeHistory&&edit.history?{consent:true,sourceRevision:inputRevision(s),sources:[{id:'earlier-conversation',name:'Reviewed earlier conversation excerpt',text:edit.history,truncated:edit.truncated}]}:null;
 return {session:s,text:text.trim(),context};
}

// Presentation transaction only. The caller must settle owned work and complete any
// authoritative restore before preparing this transaction. No network or source
// mutation is performed here; a conversation-only rewind never claims file restore.
export function prepareMessageRewind(source,edit,text,{mode='conversation_only',includeHistory=false,sourceBinding=null,sourceChanged=false}={}){
 if(!messageEditCurrent(edit,source))throw Error('message_edit_stale');
 if(!['conversation_only','checkpoint'].includes(mode))throw Error('message_rewind_mode_invalid');
 if(typeof text!=='string'||!text.trim()||text.length>6000)throw Error('message_edit_text_invalid');
 const clone=value=>JSON.parse(JSON.stringify(value));
 return {sessionId:source.id,model:source.model,sourceState:JSON.stringify([source.projectBundles||[],source.planningIntake||null]),sourceBinding:JSON.stringify(sourceBinding),sourceChanged:mode==='checkpoint'&&sourceChanged===true,index:edit.index,messageId:edit.messageId,originalText:edit.originalText,prefix:edit.prefix,transcript:JSON.stringify(source.messages),planRunId:source.pendingPlan?.runId||null,mode,text:text.trim(),history:includeHistory&&!edit.historyBlocked?edit.history:'',truncated:edit.truncated,archive:{id:'conversation_'+crypto.randomUUID(),parentMessageId:edit.messageId,messageIndex:edit.index,mode,createdAt:Date.now(),messages:clone(source.messages.slice(edit.index)),planRunId:source.pendingPlan?.runId||null}};
}
export function commitMessageRewind(source,prepared,{sourceBinding=null}={}){
 if(!prepared||prepared.sourceBinding!==JSON.stringify(sourceBinding)||prepared.sourceState!==JSON.stringify([source?.projectBundles||[],source?.planningIntake||null])||prepared.sessionId!==source?.id||prepared.model!==source.model||prepared.transcript!==JSON.stringify(source.messages)||prepared.planRunId!==(source.pendingPlan?.runId||null)||!messageEditCurrent(prepared,source))throw Error('message_edit_stale');
 if(source.liveRun?.status==='running'||source.liveRun?.status==='unconfirmed'||source.liveRun?.status==='recovering')throw Error('message_edit_work_unsettled');
 const archive=JSON.parse(JSON.stringify(prepared.archive));
 source.conversationBranches=[...(source.conversationBranches||[]),archive];
 source.messages=source.messages.slice(0,prepared.index);
 source.chatMode='plan';
 if(source.pendingPlan)source.pendingPlan={...source.pendingPlan,approved:false};
 source.previewReady=false;source.livePreviewDesired=false;
 const context=prepared.history?{consent:true,sourceRevision:inputRevision(source),sources:[{id:'earlier-conversation',name:'Earlier conversation before edited message',text:prepared.history,truncated:prepared.truncated}]}:null;
 return {session:source,text:prepared.text,context,branchId:archive.id,sourceUnchanged:prepared.sourceChanged!==true};
}

// Absence alone is not permission to retry. Only the authoritative admission
// barrier proves that this exact old operation can no longer dispatch.
export function messageOperationClosed(value,{sessionId,operationId}){
 return !!sessionId&&!!operationId&&value?.sessionId===sessionId&&value.operationId===operationId&&value.status==='not_dispatched'&&value.barrier==='immutable_operation_closure'&&value.startedCalls===0;
}
export function messageContinuationProof(value,{sessionId,operationId,messageId},now=Date.now()){return value?.sessionId===sessionId&&value.newOperationId===operationId&&value.messageId===messageId&&/^msgcontinue_[A-Za-z0-9_-]{1,160}$/.test(value.continuationReceiptId||'')&&/^msgcp_[A-Za-z0-9_-]{1,160}$/.test(value.checkpointId||'')&&value.accountingPreserved===true&&value.executionApproval===false&&value.newBranchSource==='empty'&&Number.isFinite(value.expiresAt)&&value.expiresAt>now&&value.expiresAt<=now+300000;}
