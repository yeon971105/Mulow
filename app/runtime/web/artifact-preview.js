// A new planning or discussion run must not hide previously saved outputs.
export function selectHTMLPreview(session) {
  const saved = (session.artifacts || []).filter(a =>
    a.draft!==true && typeof a.name === 'string' && /\.html?$/i.test(a.name) &&
    typeof a.runId === 'string' && a.runId.length > 0 && a.runId.length <= 200 &&
    typeof a.taskId === 'string' && typeof a.id === 'string'
  );
  const current = saved.filter(a => a.runId === session.liveRun?.runId);
  const artifact = (current.length ? current : saved).at(-1);
  if (!artifact) return null;
  const taskId = artifact.taskId.split(':').at(-1);
  const indexText = artifact.id.split(':').at(-1);
  if (!taskId || !/^\d+$/.test(indexText)) return null;
  const index = Number(indexText);
  if (!Number.isSafeInteger(index) || index < 0 || index > 1) return null;
  return {
    artifact,
    previousRun: artifact.runId !== session.liveRun?.runId,
    source: '/api/preview/' + encodeURIComponent(artifact.runId) + '/' + encodeURIComponent(taskId) + '/' + index,
  };
}
