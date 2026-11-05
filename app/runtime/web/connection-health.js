export function connectionLabel(health,api,model='nebius'){
 if(health==='offline')return 'Local server offline';
 if(health!=='online')return 'Checking local server…';
 if(model!==(api?.modelChoice||'nebius'))return 'Model not connected';
 if(api?.mock)return 'Test provider · no paid calls';
 if(api?.relay?.available)return api.connected?'Muse Spark · private connection tab required':'Muse Spark · connect private tab';
 return api?.connected?'Server reachable · key configured':'Server reachable · AI not configured';
}
export function transportFailure(error){return error instanceof TypeError||/failed to fetch|networkerror|network request|load failed/i.test(error?.message||'');}

// Readiness is not proof of a successful model request.
export function connectionBadge(health,api,model='nebius'){
 if(health==='offline')return 'Server offline';
 if(health!=='online')return 'Checking…';
 if(model!==(api?.modelChoice||'nebius'))return 'Model unavailable';
 if(api?.mock)return 'Test provider';
 if(api?.relay?.available)return api.connected?'Muse Spark connected':'Connect Muse Spark';
 return api?.connected?'Key configured':'AI not configured';
}
