import {createHash} from 'node:crypto';
import {storedPlanArtifactFields} from '../web/planning-artifact.js';
export function modelPlanArtifactFields(plan){
 const fields=storedPlanArtifactFields(plan),{planSourceEvidence,...rest}=fields;if(!planSourceEvidence)return rest;
 const references={...planSourceEvidence,citations:planSourceEvidence.citations.map(({excerpt,...citation})=>citation)};
 const projectionDigest=createHash('sha256').update(JSON.stringify({domain:'mulow-plan-source-reference-projection-v1',canonicalArtifactDigest:fields.planArtifactDigest,references})).digest('hex');
 return {...rest,planSourceReferences:{format:'mulow-plan-source-reference-projection',version:1,canonicalArtifactDigest:fields.planArtifactDigest,projectionDigest,coverage:'metadata_only_no_source_excerpt',references}};
}
export function modelPlanProjection(plan){if(!plan||plan.planSourceEvidence===undefined)return plan;const {planSourceEvidence,...rest}=plan;return {...rest,...modelPlanArtifactFields(plan)};}
