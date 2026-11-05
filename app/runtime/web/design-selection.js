// Saved design browsing is a view, never a plan/approval/input mutation.
export function displayArchitecture(s){
 // The workspace shows only its authoritative current architecture. Saved
 // versions remain immutable evidence for checkpoint restore, not gray copies.
 return s.architecture||s.designVersions?.find(v=>v.id===s.pendingPlan?.runId&&v.graph)?.graph||null;
}
export function selectDesignVersion(s,id){const v=s.designVersions?.find(v=>v.id===id&&v.graph&&Array.isArray(v.graph.nodes)&&Array.isArray(v.graph.edges));if(!v)return false;s.selectedDesignVersionId=id;s.componentSelected=null;s.architectureFocusId=null;return true;}
export function renderDesignVersions(){return '';}
