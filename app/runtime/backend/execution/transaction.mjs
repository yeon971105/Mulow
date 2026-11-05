import {LIMITS, freezeFiles, applyChanges, selectCommands} from './policy.mjs';
import {createOwnedWorkspace} from './owned-workspace.mjs';

function boundedInteger(value, max, name) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw Error(name);
}

/** Trusted adapters only. This is NOT a sandbox or a shipped Muse SDK integration. */
export async function executeTransaction({approval, baseline, commandIds, allowlist, maxAttempts = 1,
  timeoutMs = 30_000, signal, adapter, onEvent = async () => {}, workspaceFactory = createOwnedWorkspace}) {
  if (!approval || approval.localWorkspace !== true || approval.execute !== true || typeof approval.workspaceId !== 'string' || !approval.workspaceId) throw Error('explicit_workspace_execution_approval_required');
  boundedInteger(maxAttempts, LIMITS.maxAttempts, 'attempt_limit');
  boundedInteger(timeoutMs, LIMITS.maxTimeoutMs, 'timeout_limit');
  if (!adapter || typeof adapter.propose !== 'function' || typeof adapter.test !== 'function' || typeof adapter.stopAndWait !== 'function') throw Error('trusted_adapter_required');
  const original = freezeFiles(baseline), commands = selectCommands(commandIds, allowlist);
  const events = []; let sequence = 0, workspace, result, attempt = 0, previousFailure = null;
  const emit = async (state, detail = {}) => { const event = Object.freeze({sequence: ++sequence, state, ...detail}); events.push(event); await onEvent(event); };
  const controller = new AbortController();
  const cancel = () => controller.abort('cancelled');
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort('timed_out'), timeoutMs);
  async function stage(operation) {
    if (controller.signal.aborted) throw Error(controller.signal.reason);
    let listener;
    const aborted = new Promise((_, reject) => {
      listener = () => reject(Error(controller.signal.reason));
      controller.signal.addEventListener('abort', listener, {once: true});
    });
    try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
    finally { controller.signal.removeEventListener('abort', listener); }
  }
  try {
    if (controller.signal.aborted) throw Error(controller.signal.reason);
    workspace = await workspaceFactory(original);
    await emit('baseline_captured', {fileCount: original.length});
    for (attempt = 1; attempt <= maxAttempts; attempt++) {
      await emit('generating', {attempt});
      const proposal = await stage(() => adapter.propose(Object.freeze({baseline: original, attempt, previousFailure, signal: controller.signal})));
      const candidate = applyChanges(original, proposal);
      const cwd = await workspace.candidate(attempt, candidate);
      await emit('testing', {attempt});
      const test = await stage(() => adapter.test(Object.freeze({cwd, files: candidate, commands, attempt, signal: controller.signal})));
      if (!test || typeof test.passed !== 'boolean') throw Error('invalid_test_result');
      if (test.passed) {
        await emit('candidate_verified', {attempt});
        result = {status: 'candidate_verified', attempt, files: candidate, appliedToOriginal: false};
        break;
      }
      // Never forward arbitrary logs/credential-bearing subprocess output into another provider call.
      previousFailure = Object.freeze({code: 'tests_failed', attempt});
      await adapter.stopAndWait();
      await workspace.discard(attempt);
      await emit('rolled_back', {attempt});
    }
    result ??= {status: 'retry_limit_reached', attempt: maxAttempts, appliedToOriginal: false};
  } catch (error) {
    const status = controller.signal.aborted ? controller.signal.reason : 'failed';
    await emit(status, {attempt});
    result = {status, attempt, appliedToOriginal: false};
    // Only policy-owned error codes are safe to expose; provider errors may contain secrets.
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    controller.abort('transaction_finished');
    try {
      // Mandatory termination acknowledgement BEFORE deletion; no racing writers after cleanup.
      await adapter.stopAndWait();
      await workspace?.close();
      await emit('cleaned');
    } catch {
      await emit('cleanup_blocked');
      result = {...result, status: 'cleanup_blocked', candidateStatus: result?.status, cleanupRequired: true};
    }
  }
  return Object.freeze({...result, events: Object.freeze(events)});
}
