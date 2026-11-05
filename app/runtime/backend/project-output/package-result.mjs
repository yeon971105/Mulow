/** Optional suggestions never authorize execution and never invalidate valid core source. */
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim() === value && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function parsePackageResult(value) {
  if (!plain(value) || !Object.hasOwn(value, 'project')) return {project: value, decisionProposals: []};
  if (value.version !== 1) throw Object.assign(Error('package_result_version_rejected'), {code:'package_result_version_rejected'});
  if(value.activity!==undefined){if(![3,4].includes(Object.keys(value).length)||!keys(value,['version','activity','project','resultSummary'])||!text(value.activity,500)||value.resultSummary!==undefined&&!text(value.resultSummary,600))throw Object.assign(Error('public_activity_invalid'),{code:'public_activity_invalid'});return {project:value.project,decisionProposals:[],activity:value.activity,resultSummary:value.resultSummary||null};}
  let work=null;if(value.work!==undefined){const w=value.work;if(!plain(w)||Object.keys(w).length!==2||!keys(w,['title','next'])||!text(w.title,100)||!Array.isArray(w.next)||w.next.length>3||w.next.some(x=>!plain(x)||Object.keys(x).length!==2||!keys(x,['title','instruction'])||!text(x.title,100)||!text(x.instruction,2000))||new Set(w.next.map(x=>x.title)).size!==w.next.length)throw Object.assign(Error('adaptive_work_metadata_invalid'),{code:'adaptive_work_metadata_invalid'});work=structuredClone(w);}
  const invalid = () => ({project: value.project, decisionProposals: [],work, warning:'package_options_metadata_rejected'});
  if (!keys(value, ['version','project','decisionProposals','work'])) return invalid();
  if (!Object.hasOwn(value, 'decisionProposals')) return {project:value.project, decisionProposals:[],work};
  const options = value.decisionProposals;
  if (!Array.isArray(options) || options.length > 3) return invalid();
  if (options.some(option => !plain(option) || Object.keys(option).length !== 5 || !keys(option, ['label','changeRequest','rationale','uncertainty','recommendation']) || !text(option.label,160) || !text(option.changeRequest,2000) || !text(option.rationale,600) || !text(option.uncertainty,600) || typeof option.recommendation !== 'boolean')) return invalid();
  if (new Set(options.map(option => option.label.trim())).size !== options.length || options.filter(option => option.recommendation).length > 1) return invalid();
  return {project:value.project, decisionProposals:options.map(option => Object.freeze({...option})),work};
}
