// Explicit optional native Plan review scope; never inferred from an old receipt.
export const PLAN_STRUCTURAL_REPAIR_POLICY=Object.freeze({version:1,maxModelCalls:2,maxStructuralRepairs:1,feedbackMaxBytes:1024});
export function isPlanStructuralRepairPolicy(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='feedbackMaxBytes,maxModelCalls,maxStructuralRepairs,version'&&Object.entries(PLAN_STRUCTURAL_REPAIR_POLICY).every(([k,v])=>value[k]===v);}
