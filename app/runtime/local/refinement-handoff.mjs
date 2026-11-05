// Candidate-only authority: retained package source is never promoted to CURRENT here.
import { createHash, randomUUID } from "node:crypto";
import { createPackageCandidateStore } from "./package-candidate-store.mjs";
const hash = (x) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 409 });
};
const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
function createRefinementHandoff({ store, owner, pauseControls, planSnapshot, sourceSnapshot, provider, model, now = Date.now }) {
  const db = store.db, candidates = createPackageCandidateStore(store);
  db.exec(`CREATE TABLE IF NOT EXISTS refinement_handoffs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,session_id TEXT NOT NULL,run_id TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,binding TEXT NOT NULL,payload TEXT,digest TEXT,created INTEGER NOT NULL,consumed_run_id TEXT,consumed_operation TEXT,parent_id TEXT UNIQUE); CREATE UNIQUE INDEX IF NOT EXISTS refinement_handoff_original_run ON refinement_handoffs(owner,run_id) WHERE parent_id IS NULL; CREATE TABLE IF NOT EXISTS refinement_handoff_plans(owner TEXT NOT NULL,session_id TEXT NOT NULL,plan_run_id TEXT NOT NULL,handoff_id TEXT NOT NULL,PRIMARY KEY(owner,session_id,plan_run_id));`);
  const events = (runId) => db.prepare("SELECT payload FROM events WHERE run_id=? ORDER BY sequence").all(runId).map((r) => JSON.parse(r.payload));
  const rowFor = (id) => db.prepare("SELECT * FROM refinement_handoffs WHERE id=? AND owner=?").get(id, owner);
  const original = (row) => {
    if (!row) fail("handoff_not_found");
    const b = JSON.parse(row.binding), r = db.prepare("SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?").get(row.run_id, owner, row.session_id);
    if (!r) fail("handoff_run_unavailable");
    return { b, r };
  };
  function current(row, { requireOldPlan = true } = {}) {
    const { b, r } = original(row), p = planSnapshot(row.session_id), s = sourceSnapshot(row.session_id);
    if (provider() !== b.provider || model() !== b.model || JSON.stringify(s) !== JSON.stringify(b.source) || requireOldPlan && (p?.runId !== b.plan.runId || p?.digest !== b.plan.digest)) fail("handoff_context_changed");
    return { b, r, p, s };
  }
  function selected(row) {
    const { b, r } = current(row);
    if (r.status === "running" || r.reserved > 0) return null;
    if (r.usage_known !== 1) fail("handoff_usage_unknown");
    const es = events(r.id), terminal = es.at(-1);
    if (r.status !== "cancelled" || terminal?.type !== "run.cancelled" || terminal.code !== "refinement_handoff_boundary") fail("handoff_not_boundary_stopped");
    const g = es.find((e) => e.type === "project.generating" && e.strategy === "static-react-packages-v1");
    if (!g || g.planRunId !== b.plan.runId || !hex(g.planRevision)) fail("handoff_package_history_invalid");
    let parent = g.refinementHandoff?.candidateRevision || g.sourceBaseAdoption?.externalRevision || g.baseSourceRevision || null, last = null;
    const accepted = [];
    for (const done of es.filter((e) => e.type === "task.completed" && e.meaning === "source_package_compiled")) {
      const v = es.find((e) => e.sequence < done.sequence && e.type === "validation.completed" && e.taskId === done.taskId && e.sourceVerification?.status === "compiled" && e.packageCheckpoint?.candidateRevision === done.candidateRevision && JSON.stringify(e.packageBinding) === JSON.stringify(done.packageBinding));
      if (!v || done.packageBinding.parentCandidateRevision !== parent || accepted.includes(done.taskId)) fail("handoff_package_history_invalid");
      const c = { owner, sessionId: row.session_id, runId: r.id, planRunId: b.plan.runId, planRevision: g.planRevision, baseRevision: g.baseSourceRevision || null, taskIds: b.plan.tasks.map((t) => t.id), ...g.sourceBaseAdoption ? { sourceBaseAdoption: g.sourceBaseAdoption } : {}, ...g.refinementHandoff ? { refinementHandoff: g.refinementHandoff } : {} };
      last = candidates.read(c, done.packageBinding, done.candidateRevision);
      if (last.recordDigest !== v.packageCheckpoint.recordDigest || last.receipt.status !== "compiled") fail("handoff_package_history_invalid");
      accepted.push(done.taskId);
      parent = done.candidateRevision;
    }
    if (!last) fail("handoff_no_accepted_candidate");
    if (b.expectedCheckpoint && (last.candidateRevision !== b.expectedCheckpoint.candidateRevision || last.recordDigest !== b.expectedCheckpoint.recordDigest)) fail("handoff_option_checkpoint_stale");
    return { candidate: last.candidate, candidateRevision: last.candidateRevision, recordDigest: last.recordDigest, packageBinding: last.packageBinding, completedTaskIds: accepted, originalRunId: r.id, originalPlanRunId: b.plan.runId, originalPlanDigest: b.plan.digest, nativeRevision: b.source.revision, nativeCurrentHash: b.source.currentHash, execution: "not_run", tests: "not_run", browser: "unverified", published: false };
  }
  function ready(row) {
    const payload = selected(row);
    if (!payload) return null;
    const digest = hash({ binding: JSON.parse(row.binding), payload });
    if (row.payload && (row.digest !== digest || row.payload !== JSON.stringify(payload))) fail("handoff_checkpoint_changed");
    if (!row.payload) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const b = JSON.parse(row.binding);
        db.prepare("UPDATE refinement_handoffs SET payload=?,digest=? WHERE id=? AND payload IS NULL").run(JSON.stringify(payload), digest, row.id);
        db.prepare("DELETE FROM plan_approvals WHERE run_id=? AND session_id=?").run(b.plan.runId, row.session_id);
        db.prepare("DELETE FROM build_start_receipts WHERE plan_run_id=? AND session_id=? AND operation_id IS NULL").run(b.plan.runId, row.session_id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      row = rowFor(row.id);
    }
    return { row, payload, digest };
  }
  function reference(row) {
    if (!row?.payload || !hex(row.digest)) fail("handoff_not_ready");
    const p = JSON.parse(row.payload);
    if (hash({ binding: JSON.parse(row.binding), payload: p }) !== row.digest) fail("handoff_checkpoint_changed");
    return { handoffId: row.id, digest: row.digest, candidateRevision: p.candidateRevision, recordDigest: p.recordDigest, originalRunId: p.originalRunId, originalPlanRunId: p.originalPlanRunId };
  }
  function status(input) {
    const row = db.prepare("SELECT * FROM refinement_handoffs WHERE owner=? AND session_id=? AND run_id=? AND operation_id=?").get(owner, input.sessionId, input.runId, input.operationId);
    const { b, r } = original(row), base = { sessionId: row.session_id, runId: row.run_id, planRunId: b.plan.runId, sourceRevision: b.plan.sourceRevision || null, operationId: row.operation_id, parentHandoffId: row.parent_id || null, requestDigest: b.requestDigest, provider: b.provider, model: b.model, nativeRevision: b.source.revision, execution: "not_run", freshApprovalRequired: true, expiresAt:new Date(row.created+900000).toISOString() };
    try {
      current(row);
      if (r.status === "running") return { ...base, phase: pauseControls.has(r.id) ? "draining" : "blocked", ...pauseControls.has(r.id) ? {} : { reason: "handoff_continuation_lost" } };
      if (r.reserved > 0) return { ...base, phase: "settling" };
      const result = ready(row);
      return { ...base, phase: db.prepare("SELECT 1 FROM refinement_handoffs WHERE parent_id=?").get(row.id)?"blocked":now()-row.created>900000?"blocked":"ready", ...(db.prepare("SELECT 1 FROM refinement_handoffs WHERE parent_id=?").get(row.id)?{reason:"handoff_superseded"}:now()-row.created>900000?{reason:"handoff_expired"}:{}), ...reference(result.row), completedTaskIds: result.payload.completedTaskIds, sourceKind: "accepted_unpublished_candidate", accountingKnown: true, terminalStatus: r.status };
    } catch (e) {
      return { ...base, phase: "blocked", reason: e.code || "handoff_unavailable" };
    }
  }
  return {
    async request(input, expectedCheckpoint = null) {
      if (!input || input.allowModelContext !== true || !/^handoff_[A-Za-z0-9_-]{1,100}$/.test(input.operationId || "") || typeof input.requestText !== "string" || !input.requestText.trim() || input.requestText !== input.requestText.trim() || input.requestText.length > 6e3 || input.provider !== provider() || input.model !== model()) fail("handoff_input_invalid");
      if(expectedCheckpoint && (!hex(expectedCheckpoint.expectedCandidateRevision)||!hex(expectedCheckpoint.expectedRecordDigest)||Object.keys(expectedCheckpoint).length!==2))fail("handoff_input_invalid");
      const expected = expectedCheckpoint ? {candidateRevision:expectedCheckpoint.expectedCandidateRevision,recordDigest:expectedCheckpoint.expectedRecordDigest} : null;
      const existing = db.prepare("SELECT * FROM refinement_handoffs WHERE owner=? AND run_id=? AND parent_id IS NULL").get(owner, input.runId);
      if (existing) {
        const b2 = JSON.parse(existing.binding);
        if (existing.session_id !== input.sessionId || existing.operation_id !== input.operationId || JSON.stringify(b2.expectedCheckpoint||null)!==JSON.stringify(expected)||b2.requestDigest !== hash(input.requestText) || b2.plan.runId !== input.planRunId || (b2.plan.sourceRevision || null) !== (input.sourceRevision || null)) fail("handoff_already_claimed");
        return status(input);
      }
      const r = db.prepare("SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?").get(input.runId, owner, input.sessionId), p = planSnapshot(input.sessionId), control = pauseControls.get(input.runId);
      if (!r || r.status !== "running" || !control || p?.runId !== input.planRunId || r.model !== model() || (p.sourceRevision || null) !== (input.sourceRevision || null)) fail("handoff_run_unavailable");
      const es = events(r.id), g = es.find((e) => e.type === "project.generating");
      if (g?.strategy !== "static-react-packages-v1" || g.planRunId !== p.runId) fail("handoff_strategy_unsupported");
      if(expected){
        const pausedState=control.status({sessionId:input.sessionId,runId:input.runId});
        if(pausedState.phase!=="paused"||pausedState.canResume!==true)fail("handoff_option_not_paused");
        const done=es.filter(e=>e.type==="task.completed"&&e.meaning==="source_package_compiled").at(-1);
        const verified=done&&es.find(e=>e.type==="validation.completed"&&e.sequence<done.sequence&&e.taskId===done.taskId&&e.sourceVerification?.status==="compiled"&&e.packageCheckpoint?.candidateRevision===done.candidateRevision&&JSON.stringify(e.packageBinding)===JSON.stringify(done.packageBinding));
        if(done?.candidateRevision!==expected.candidateRevision||verified?.packageCheckpoint?.recordDigest!==expected.recordDigest)fail("handoff_option_checkpoint_stale");
      }
      const source = sourceSnapshot(input.sessionId);
      if ((g.baseSourceRevision || null) !== source.revision) fail("handoff_context_changed");
      const b = { owner, sessionId: input.sessionId, originalOperationId: r.operation, provider: provider(), model: model(), plan: p, source, requestDigest: hash(input.requestText), ...(expected?{expectedCheckpoint:expected}:{}) }, id = "refinehandoff_" + randomUUID();
      db.prepare("INSERT INTO refinement_handoffs(id,owner,session_id,run_id,operation_id,binding,created) VALUES(?,?,?,?,?,?,?)").run(id, owner, input.sessionId, r.id, input.operationId, JSON.stringify(b), now());
      await control.handoff(input);
      return status(input);
    },
    status,
    reReview(input) {
      if (!input || input.allowModelContext !== true || input.provider !== provider() || input.model !== model() || !/^handoff_[A-Za-z0-9_-]{1,100}$/.test(input.operationId || "") || typeof input.requestText !== "string" || !input.requestText.trim() || input.requestText !== input.requestText.trim() || input.requestText.length > 6e3) fail("handoff_input_invalid");
      db.exec("BEGIN IMMEDIATE");
      try {
        const parent = rowFor(input.handoffId);
        if (parent?.session_id !== input.sessionId || !parent.payload) fail("handoff_retry_unavailable");
        const child = db.prepare("SELECT * FROM refinement_handoffs WHERE parent_id=? AND owner=?").get(parent.id, owner);
        if (child) {
          if (child.operation_id !== input.operationId || JSON.parse(child.binding).requestDigest !== hash(input.requestText) || child.consumed_run_id) fail("handoff_retry_already_claimed");
          db.exec("COMMIT");
          return status({ sessionId: child.session_id, runId: child.run_id, operationId: child.operation_id });
        }
        if(parent.consumed_run_id){
        const prior = db.prepare("SELECT * FROM runs WHERE id=? AND owner=? AND session_id=?").get(parent.consumed_run_id, owner, input.sessionId);
        const priorEvents = prior ? events(prior.id) : [];
        if (!prior || !["completed", "failed", "cancelled"].includes(prior.status) || prior.reserved !== 0 || prior.usage_known !== 1 || prior.operation !== parent.consumed_operation || priorEvents.at(-1)?.type !== "run." + prior.status || priorEvents.some((e) => ["plan.proposed", "plan.created"].includes(e.type))) fail("handoff_retry_unavailable");
        }else if(now()-parent.created<=900000)fail("handoff_retry_unavailable");
        if (db.prepare("SELECT 1 FROM runs WHERE owner=? AND (status='running' OR reserved>0 OR usage_known=0) LIMIT 1").get(owner)) fail("handoff_retry_accounting_unconfirmed");
        let depth = 0, cursor = parent;
        while (cursor?.parent_id) {
          if (++depth > 32) fail("handoff_retry_limit");
          cursor = rowFor(cursor.parent_id);
          if (!cursor) fail("handoff_retry_unavailable");
        }
        const payload = selected(parent);
        if (!payload) fail("handoff_not_ready");
        const oldBinding = JSON.parse(parent.binding);
        if (hash({ binding: oldBinding, payload }) !== parent.digest) fail("handoff_checkpoint_changed");
        const binding = { ...oldBinding, requestDigest: hash(input.requestText) }, id = "refinehandoff_" + randomUUID(), digest = hash({ binding, payload });
        db.prepare("INSERT INTO refinement_handoffs(id,owner,session_id,run_id,operation_id,binding,payload,digest,created,parent_id) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, owner, input.sessionId, parent.run_id, input.operationId, JSON.stringify(binding), JSON.stringify(payload), digest, now(), parent.id);
        db.exec("COMMIT");
        return status({ sessionId: input.sessionId, runId: parent.run_id, operationId: input.operationId });
      } catch (e) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw e;
      }
    },
    resolvePlan({ sessionId, handoffId, requestText, allowModelContext }) {
      if (allowModelContext !== true) fail("handoff_consent_required");
      const row = rowFor(handoffId);
      if (row?.session_id !== sessionId || row.consumed_run_id) fail("handoff_consumed");
      if(db.prepare("SELECT 1 FROM refinement_handoffs WHERE parent_id=?").get(row.id))fail("handoff_superseded");
      if (now() - row.created > 9e5) fail("handoff_expired");
      const { b } = current(row);
      if (hash(requestText) !== b.requestDigest) fail("handoff_request_changed");
      const result = ready(row);
      if (!result) fail("handoff_not_ready");
      const p = result.payload, context = { provenance: "accepted_unpublished_package_checkpoint", ...reference(result.row), nativeRevision: p.nativeRevision, completedPackages: p.completedTaskIds.map((taskId) => ({ taskId, status: "compiled", execution: "not_run", tests: "not_run" })), files: p.candidate.files.map((f) => ({ path: f.path, content: f.content })), entrypoints: p.candidate.manifest.entrypoints, dependencies: p.candidate.manifest.dependencies, published: false, browser: "unverified" };
      return { binding: result.digest, context };
    },
    assertPlanningCurrent({sessionId,handoffId,binding,runId,operationId}) {
      const row=rowFor(handoffId);if(row?.session_id!==sessionId||row.digest!==binding||row.consumed_run_id!==runId||row.consumed_operation!==operationId)fail("handoff_context_changed");
      current(row);const payload=selected(row);if(!payload||hash({binding:JSON.parse(row.binding),payload})!==row.digest)fail("handoff_checkpoint_changed");return true;
    },
    validateReservation({ handoffId, binding, owner: who, sessionId, model: chosen }) {
      const row = rowFor(handoffId);
      if (who !== owner || row?.session_id !== sessionId || row.consumed_run_id || now() - row.created > 9e5 || row.digest !== binding || chosen !== model()) return false;
      if(db.prepare("SELECT 1 FROM refinement_handoffs WHERE parent_id=?").get(row.id))return false;
      current(row);
      if (!row.payload) return false;
      reference(row);
      const payload = selected(row);
      return !!payload && hash({ binding: JSON.parse(row.binding), payload }) === row.digest;
    },
    consumeReservation(args) {
      if (!db.isTransaction || !this.validateReservation(args)) return false;
      return db.prepare("UPDATE refinement_handoffs SET consumed_run_id=?,consumed_operation=? WHERE id=? AND consumed_run_id IS NULL").run(args.runId, args.operationId, args.handoffId).changes === 1;
    },
    attachPlan({ sessionId, proposalRunId, newPlanRunId, basePlanRunId }) {
      if (!db.isTransaction) fail("handoff_transaction_required");
      let row = db.prepare("SELECT * FROM refinement_handoffs WHERE owner=? AND session_id=? AND consumed_run_id=?").get(owner, sessionId, proposalRunId);
      if (!row) {
        const prior = db.prepare("SELECT handoff_id FROM refinement_handoff_plans WHERE owner=? AND session_id=? AND plan_run_id=?").get(owner, sessionId, basePlanRunId);
        if (prior) row = rowFor(prior.handoff_id);
      }
      if (!row) return null;
      current(row, { requireOldPlan: false });
      db.prepare("INSERT INTO refinement_handoff_plans VALUES(?,?,?,?)").run(owner, sessionId, newPlanRunId, row.id);
      return reference(row);
    },
    currentBinding(sessionId, planRunId = planSnapshot(sessionId)?.runId) {
      if (!planRunId) return null;
      const m = db.prepare("SELECT handoff_id FROM refinement_handoff_plans WHERE owner=? AND session_id=? AND plan_run_id=?").get(owner, sessionId, planRunId);
      if (!m) return null;
      const row = rowFor(m.handoff_id);
      current(row, { requireOldPlan: false });
      return reference(row);
    },
    modelSource({ sessionId, planRunId, expectedNativeRevision, expectedNativeCurrentHash, maxContextBytes }) {
      const ref = this.currentBinding(sessionId, planRunId);
      if (!ref) return null;
      const row = rowFor(ref.handoffId), p = JSON.parse(row.payload);
      if (p.nativeRevision !== expectedNativeRevision || p.nativeCurrentHash !== expectedNativeCurrentHash) fail("handoff_context_changed");
      const source = { revision: p.nativeRevision, handoffCandidateRevision: p.candidateRevision, refinementHandoff: ref, provenance: "reviewed_refinement_checkpoint", entrypoints: p.candidate.manifest.entrypoints, dependencies: p.candidate.manifest.dependencies, files: p.candidate.files.map((f) => ({ path: f.path, content: f.content })) };
      if (!Number.isSafeInteger(maxContextBytes) || Buffer.byteLength(JSON.stringify(source)) > maxContextBytes) fail("handoff_context_limit");
      return source;
    },
    releaseAfterPublication({ sessionId, planRunId }) {
      if (!db.isTransaction) fail("handoff_transaction_required");
      db.prepare("DELETE FROM refinement_handoff_plans WHERE owner=? AND session_id=? AND plan_run_id=?").run(owner, sessionId, planRunId);
    }
  };
}
export {
  createRefinementHandoff
};
