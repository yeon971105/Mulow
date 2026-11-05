import {randomUUID, createHash} from 'node:crypto';
import {readConfig, modelJson} from '../orchestrator.mjs';
import {executeTransaction} from './transaction.mjs';
import {createOfflineFixtureRunner, fixtureAllowlist} from './fixture-runner.mjs';

export const SYNTHETIC_WORKSPACE = 'synthetic-text-v1';
const BASELINE = Object.freeze([Object.freeze({path: 'result.txt', content: 'original\n'})]);
const snapshotHash = createHash('sha256').update(JSON.stringify(BASELINE)).digest('hex');
export const executionCapabilities = Object.freeze({
  revision: 'synthetic-execution-v1', snapshotHash, providerTransport: 'existing-nebius-chat-completions', museSdkConnected: false,
  syntheticFixture: true, projectExecution: false, osSandboxVerified: false,
  workspaceId: SYNTHETIC_WORKSPACE, maxAttempts: 3, commands: ['fixture:text'],
  limitation: 'Only an isolated synthetic text fixture is executable. Generated project code and shell commands remain disabled until an OS sandbox is verified.',
  baseline: BASELINE, expectedResult: 'result.txt must contain exactly pass followed by a newline.'
});
function fail(code, status = 400) { return Response.json({error: code}, {status}); }
function policyHash(config) { return createHash('sha256').update(JSON.stringify({endpoint:config.endpoint,model:config.model,inputPrice:config.inputPrice,outputPrice:config.outputPrice,outputTokens:config.outputTokens,outputPolicy:config.outputPolicy,contextTokens:config.contextTokens,thinkingMode:config.thinkingMode,inputBytes:config.inputBytes,tokenField:config.tokenField,maxCallUsd:config.maxCallUsd,runCap:config.runCap,budget:config.budget})).digest('hex'); }
function validSession(value) { return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value); }

/** Receives the EXISTING store; never creates/reinitializes a separate budget or credential path. */
export function createExecutionService({store, env, fetcher = fetch}) {
  if (!store?.durable || !store?.atomicReservation || !store.db) throw Error('existing_durable_store_required');
  store.db.exec(`CREATE TABLE IF NOT EXISTS execution_approvals (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL, max_attempts INTEGER NOT NULL,
    approved_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, revision TEXT, policy_hash TEXT)`);
  if (!store.db.prepare('PRAGMA table_info(execution_approvals)').all().some(column => column.name === 'revision')) store.db.exec('ALTER TABLE execution_approvals ADD COLUMN revision TEXT');
  if (!store.db.prepare('PRAGMA table_info(execution_approvals)').all().some(column => column.name === 'policy_hash')) store.db.exec('ALTER TABLE execution_approvals ADD COLUMN policy_hash TEXT');
  return {
    approve(input) {
      if (!validSession(input.sessionId) || input.workspaceId !== SYNTHETIC_WORKSPACE || input.snapshotHash !== snapshotHash || input.revision !== executionCapabilities.revision || input.execute !== true || input.transmitSnapshot !== true || !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 3) return fail('explicit_synthetic_workspace_approval_required');
      // Baseline is application-owned; never accept paths, imported source, commands or hidden context.
      if (Object.keys(input).some(k => !['sessionId','workspaceId','snapshotHash','revision','execute','transmitSnapshot','maxAttempts'].includes(k))) return fail('unsupported_execution_input');
      let config; try { config = readConfig({...env, ENABLE_LIVE_RUNS: 'true', MODEL_API_KEY: 'status-only'}, {runtime: 'loopback'}); } catch { return fail('provider_configuration_required', 503); }
      const approvalId = randomUUID();
      store.db.prepare('INSERT INTO execution_approvals (id,session_id,workspace_id,snapshot_hash,max_attempts,approved_at,consumed,revision,policy_hash) VALUES(?,?,?,?,?,?,0,?,?)').run(approvalId, input.sessionId, SYNTHETIC_WORKSPACE, snapshotHash, input.maxAttempts, Date.now(), executionCapabilities.revision, policyHash(config));
      return Response.json({approvalId, sessionId: input.sessionId, workspaceId: SYNTHETIC_WORKSPACE, snapshotHash, maxAttempts: input.maxAttempts, reservationUsd: config.maxCallUsd * input.maxAttempts, expiresInSeconds: 600});
    },
    async run(input) {
      let config;
      try { config = readConfig(env, {runtime: 'loopback'}); } catch { return fail('provider_configuration_required', 503); }
      if (!validSession(input.sessionId) || typeof input.operationId !== 'string' || !/^[-a-zA-Z0-9_]{8,100}$/.test(input.operationId) || typeof input.approvalId !== 'string' || Object.keys(input).some(k => !['sessionId','operationId','approvalId'].includes(k))) return fail('invalid_execution_request');
      const approval = store.db.prepare('SELECT * FROM execution_approvals WHERE id=? AND session_id=? AND consumed=0').get(input.approvalId, input.sessionId);
      if (!approval || approval.policy_hash !== policyHash(config) || approval.revision !== executionCapabilities.revision || approval.workspace_id !== SYNTHETIC_WORKSPACE || approval.snapshot_hash !== snapshotHash || Date.now() - approval.approved_at > 600_000) return fail('execution_approval_required', 409);
      const consumed = store.db.prepare('UPDATE execution_approvals SET consumed=1 WHERE id=? AND consumed=0').run(approval.id);
      if (consumed.changes !== 1) return fail('execution_approval_consumed', 409);
      const runId = 'run_' + randomUUID(), owner = config.owner;
      const reservationUsd = config.maxCallUsd * approval.max_attempts;
      if (reservationUsd > config.runCap) return fail('execution_run_cap_exceeded', 409);
      let reservation;
      try { reservation = await store.reserve({runId, operationId: input.operationId, owner, reservationUsd, budgetUsd: config.budget, model: config.model, sessionId: input.sessionId}); }
      catch { return fail('budget_store_unavailable', 503); }
      if (!reservation.accepted) return fail(reservation.reason || 'budget_reservation_rejected', 409);
      const controller = new AbortController(), accounting = {started: 0, accounted: 0, reported: 0, spent: 0};
      const runner = createOfflineFixtureRunner(), pending = new Set();
      let sequence = 0, cancelled = false;
      const stream = new ReadableStream({
        start(output) {
          const emit = async (type, data = {}) => {
            const event = {id: runId + ':' + (++sequence), runId, sequence, type, time: new Date().toISOString(), ...data};
            await store.appendEvent(runId, owner, event);
            if (!cancelled) output.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
          };
          (async () => {
            let status = 'failed';
            try {
              await emit('run.started', {mode: 'synthetic_execution', model: config.model, sessionId: input.sessionId, budgetReservedUsd: reservationUsd, workspaceId: SYNTHETIC_WORKSPACE, maxAttempts: approval.max_attempts, projectExecution: false});
              const adapter = {
                propose({baseline, attempt, previousFailure, signal}) {
                  if (accounting.started >= approval.max_attempts) throw Error('reserved_call_limit');
                  const messages = [{role: 'system', content: 'Return only JSON {"changes":[{"operation":"write","path":"result.txt","content":"pass\\n"}]}. This is an explicitly approved synthetic text-verification exercise, not a real project. Write result.txt with exactly pass followed by one newline. Do not claim you executed anything. No other paths, commands, network, or tools are allowed.'}, {role: 'user', content: JSON.stringify({baseline, attempt, previousFailure, testRequirement: 'result.txt === "pass\\n"'})}];
                  const operation = modelJson(config, messages, fetcher, signal, accounting).then(value => {
                    if (!Array.isArray(value?.changes) || value.changes.length !== 1 || value.changes[0]?.operation !== 'write' || value.changes[0]?.path !== 'result.txt' || typeof value.changes[0]?.content !== 'string' || Buffer.byteLength(value.changes[0].content) > 1024) throw Error('invalid_synthetic_patch');
                    return value.changes;
                  });
                  pending.add(operation); operation.then(() => pending.delete(operation), () => pending.delete(operation));
                  return operation;
                },
                test: runner.test,
                async stopAndWait() { await runner.stopAndWait(); await Promise.allSettled([...pending]); }
              };
              const result = await executeTransaction({approval: {localWorkspace: true, execute: true, workspaceId: SYNTHETIC_WORKSPACE}, baseline: BASELINE, commandIds: ['fixture:text'], allowlist: fixtureAllowlist, maxAttempts: approval.max_attempts, timeoutMs: 120_000, signal: controller.signal, adapter,
                onEvent: event => emit('execution.' + event.state, {attempt: event.attempt || null, summary: event.state === 'rolled_back' ? 'Synthetic candidate failed the exact text test; only its owned temporary files were removed.' : event.state, projectExecution: false})});
              status = result.status === 'candidate_verified' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed';
              await emit(status === 'completed' ? 'run.completed' : 'run.failed', {meaning: result.status, execution: 'synthetic_fixture_only', tests: status === 'completed' ? 'trusted_text_fixture_passed' : 'not_passed', verified: status === 'completed', appliedToOriginal: false, files: result.files || [], projectExecution: false});
            } catch { controller.abort(); try { await emit('run.failed', {code: 'execution_failed', projectExecution: false}); } catch {} }
            finally {
              controller.abort(); await runner.stopAndWait(); await Promise.allSettled([...pending]);
              const uncertain = Math.max(0, accounting.started - accounting.accounted);
              try { await store.settle({runId, owner, status, chargedUsd: accounting.spent + uncertain * config.maxCallUsd, startedCalls: accounting.started, usageKnown: uncertain === 0 && accounting.reported === accounting.started, reason: uncertain || accounting.reported !== accounting.started ? 'conservative_unknown_call_charge' : 'reported_usage'}); }
              catch { try { await emit('accounting.unknown', {reservationRetained: true}); } catch {} }
              if (!cancelled) output.close();
            }
          })();
        },
        cancel() { cancelled = true; controller.abort(); }
      });
      return new Response(stream, {headers: {'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store'}});
    }
  };
}
