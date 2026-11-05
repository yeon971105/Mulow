// Goal identity is independent from task execution, artifacts and node selection.
export function selectedGoal(session={},runId=null){
 const current=session.pendingPlan,records=[current,...(session.planHistory||[]),...(session.goalHistory||[])].filter(Boolean);
 const plan=runId?records.find(p=>p.runId===runId):current;
 if(runId&&!plan)return {text:'The selected goal is unavailable in this saved version.',runId,unavailable:true};
 const full=typeof plan?.goal==='string'&&plan.goal.trim()?plan.goal.trim():!runId&&typeof session.goal==='string'?session.goal.trim():'';
 const summary=typeof plan?.goalSummary==='string'&&plan.goalSummary.trim()&&plan.goalSummary.length<=240?plan.goalSummary.trim():'';
 return {text:summary||full||'Your goal will take shape as we talk.',runId:plan?.runId||null,summary:!!summary,unavailable:false};
}
export function renderSelectedGoal(session,runId,esc,{dialog=false,closeAction='close-work'}={}){
 const goal=selectedGoal(session,runId),long=goal.text.length>280;
 return '<section class="'+(dialog?'name-editor':'progress-panel')+' goal-details goal-simple" '+(dialog?'role="dialog" aria-modal="true"':'')+' aria-label="Goal details" data-goal-run="'+esc(goal.runId||'')+'"><header><h2>Goal</h2><button type="button" class="icon-btn" data-action="'+closeAction+'" aria-label="Close goal details">×</button></header><p class="goal-statement '+(long?'goal-collapsed':'')+'">'+esc(goal.text)+'</p>'+(long?'<button type="button" class="goal-expand" data-goal-expand aria-expanded="false">Show full goal</button>':'')+'</section>';
}
