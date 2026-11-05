# Reviewed React / Node HTTP container runtime (27)

Default is **unavailable**. No image digest is fabricated and no image is pulled,
built, installed, or provisioned by the app. Owner provisioning and explicit
approval of an immutable image reference are prerequisites, not test results.

API `createProjectRuntime({runner?, approvedImage, sourceRoot})`:
- `preflight()` inspects the local Docker context/engine and locally present pinned
  image; it does not execute project code. Requires local Unix Docker endpoint,
  Linux engine, exact RepoDigest, runtime profile and trusted script hash labels.
- `start({operationId, snapshotDirectory, profile:'react-node-http-v1', signal,
  onProgress})` is called ONLY after parent service's explicit scoped approval.
  Snapshot must be beneath sourceRoot, immutable owned copy, no symlinks/special
  files, at most 200 files/5MiB. Resolves fixed supported entries, builds and starts
  inside a constrained owned container. Returns opaque handle and observed build /
  startup evidence. This is NOT a functional test pass.
- `fetchPreview(handle, pathname, {method:'GET'|'POST',body:Buffer,contentType:'application/json'|'text/plain'})` invokes only the reviewed fetch bridge with a
  relative URL argument. GET or bounded JSON/text POST only, fixed localhost:4173 inside container, no
  redirects, bounded response. Parent must serve via sandboxed iframe on isolated
  origin/CSP, never as privileged same-origin application HTML.
- `stop(handle)` verifies exact owned labels/image before stopping/removing only
  that container. Cancellation and failed startup attempt cleanup; cleanup failure
  is surfaced, not silently labelled stopped. Process restart loses handles and
  does not claim any container stopped; owner must inspect labels for orphan cleanup.

Profile: frontend entry exactly one of src/main.jsx, src/main.tsx, src/main.js;
optional backend exactly one of server/index.mjs, server/index.js, server.mjs.
Frontend may import reviewed image React / ReactDOM and local files. Backend may
import local files / Node builtins; external packages are unsupported. Backend must
listen on PORT=3001, HOST=127.0.0.1. `/api/*` is proxied to that fixed backend only.
No package.json script, generated build config/plugin or install step is executed.

Container: network none; no published ports; nonroot 10001; read-only root;
cap-drop ALL; no-new-privileges; 1 CPU, 512MiB RAM/no swap, 64 PIDs; bounded tmpfs
/out (64MiB) and /tmp (16MiB); 10-minute fixed PID 1 lifetime. Only owned source
is bind-mounted read-only; no home/credentials/socket/host output mounts. Generated
code can write only bounded ephemeral output. No host arbitrary code execution.

## Image provisioning (manual, separate authority)
Use image/Dockerfile only after reviewing trusted scripts. Provide a digest-pinned
Linux Node base image and pre-audited vendor/node_modules containing esbuild 0.25.12,
React 19.1.0, ReactDOM 19.1.0 and exact locked transitive/platform dependencies.
Vendor acquisition/build is NOT performed by this repository. Record provenance,
package integrity hashes, platform and final immutable image RepoDigest externally.
Set build argument TRUSTED_SOURCE_SHA256 to `trustedSourceHash()` from adapter.mjs.
The final image must have matching org.musepilot.profile and
org.musepilot.trusted-source-sha256 labels; approve that exact locally available
RepoDigest. Labels alone are not provenance: the owner must review the image before
approval. Base/vendor placeholders intentionally prevent accidental provisioning.

Cloud tests use an injected command runner; no Docker daemon/image/model calls.
Official constraints: https://docs.docker.com/reference/cli/docker/container/run/
https://docs.docker.com/engine/network/drivers/none/
https://docs.docker.com/engine/security/

Preview supports GET and POST with <=64KiB JSON/text bodies forwarded only to the owned localhost backend. No functional API test pass is inferred from transport success. Generated browser code must use relative ./api paths under the capability URL; absolute /api routes fail closed. HTML assets use relative paths.

### Explicit local image approval
The normal launcher stays disconnected from execution unless an operator has reviewed
and provisioned the trusted runtime image. After checking its provenance, exact digest,
profile labels and trusted-source hash, the operator may create the **local data directory**
file `runtime-image-approval.json` with exactly:

```json
{"approved":true,"image":"reviewed/repository@sha256:<64 lowercase hex characters>"}
```

Replace the placeholder with the reviewed immutable digest; do not approve an unknown
image or mutable tag. The file must be owned by the launcher user, regular (not a
symlink), and mode `0600`. Restart the launcher after manual approval. No approval
file is created automatically, and reading it never pulls, installs, or executes an
image. Runtime preflight still checks the installed image and trusted profile before
any explicit per-project execution approval. Missing configuration leaves execution
unavailable; invalid configuration fails closed.

Local manual builds may be approved by exact content-addressed `sha256:<64hex>` image ID. In this mode inspect.Id must equal the approved ID; RepoDigests is not fabricated or required. Registry `repo@sha256` approvals still require RepoDigests membership. Mutable tags remain rejected. Both modes require the same script/profile labels and owner-reviewed provenance.

A reviewed locally built image may instead be approved by its exact immutable local
image ID: `{"approved":true,"image":"sha256:<64 lowercase hex characters>"}`.
This is not a tag or abbreviated ID. Review the local build provenance before writing
the approval; preflight requires exact inspected image-ID equality, the trusted profile
labels and trusted-source hash. Repository digest approvals remain supported unchanged.
