# Reviewed SQLite full-stack fixture — optional Docker prerequisite

Three components: React UI → Node HTTP API → SQLite database. This is a small synthetic persistence test, **not a substitute for a requested Postgres system or evidence that an arbitrary app is verified**.

## What is implemented
- `../sqlite-profile.mjs`: exact owner/session/source/plan/image binding, bounded checkpoint storage, one active durable operation journal, Stop and explicit database deletion, fixed CRUD/restart verification.
- `../sqlite-adapter.mjs`: actual fixed Docker CLI construction, no pull/install, no writable host mount, no generated host execution, network none, nonroot application UID 10001, read-only source, bounded tmpfs.
- `../sqlite-image/`: trusted reviewed helpers. SQLite export/restore runs as separate UID 10002, with private `/checkpoint` inaccessible to generated UID 10001. The bridge carries only bounded GET/POST JSON; no model shell or restart commands.
- `run-reviewed.mjs`: explicit opt-in harness for this exact fixture. No product server route is enabled automatically. The existing authenticated Mulo runtime UI still requires separate integration before this profile appears there.

## Prerequisites (not provisioned by the app)
A supported local Docker Linux engine with Unix socket; an owner-reviewed immutable image built from `../sqlite-image/Dockerfile`; a digest-pinned Node base that provides `node:sqlite`; reviewed vendor modules matching the existing build helper (esbuild 0.25.12, React/ReactDOM 19.1.0 and their locked transitive dependencies). The repository does not download these prerequisites. Set image label source hash via `sqliteTrustedSourceHash()` from `../sqlite-adapter.mjs`; approve the exact local image ID, never a mutable tag. Existing `react-node-http-v1` images do not qualify.

Once those prerequisites have been separately reviewed and provisioned, run:

```
node run-reviewed.mjs --approve-reviewed-fixture sha256:<reviewed-64hex-image-id> <private-data-directory>
```

This builds the frontend/API inside Docker; creates one synthetic record; takes a consistent SQLite snapshot; externally removes the old container; starts a new owned container with the exact snapshot; reads, updates, reads, deletes and confirms deletion through fixed API checks; then Stops and preserves the final database checkpoint. The generated app's server file is never imported on the host. No actual Docker execution was performed in the cloud development environment.

## Persistence semantics and limits
Database scope is **one owner + one Mulo session**. A session represents this fixture project; no unrelated projectId is inferred. Checkpoints include exact source/plan/image/helper hashes and database digest. Changed source/plan/image refuses implicit migration; a future reviewed migration contract is required.

The checkpoint is a consistent SQLite snapshot at a specific point before container removal. New bridge requests are blocked once stopping begins. Arbitrary background writes after that snapshot are **not preserved**; there is no claim that all generated processes were quiescent. Host checkpoint commit occurs only after verified Docker removal. Stop does not delete a prior checkpoint. Explicit teardown affects only this owner/session database. Database payload ≤4 MiB, source runtime container ≤10 minutes, no persistence guarantee for a crashed/expired container before checkpoint. Private checkpoint tmpfs is 8 MiB; generated `/data` tmpfs is separately bounded at 8 MiB.

Durable `.active.json` journals block another process/controller after uncertain startup/removal or process crash. They must not be blindly deleted to retry; owner inspection of the exact labelled container is required. The module intentionally offers no unsafe automatic orphan recovery. A known retained handle permits cleanup-only Stop retry, without re-export or new model call.

Reports distinguish HTTP CRUD/restart checks from untested browser interaction, security assurance, and full goal completion. Injected-adapter tests validate lifecycle/command contracts only; they are not Docker execution evidence.
