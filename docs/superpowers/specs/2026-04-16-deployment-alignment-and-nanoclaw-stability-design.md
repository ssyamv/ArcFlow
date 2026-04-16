> 文档状态：当前阶段参考。此文档与当前 NanoClaw / Gateway 主线直接相关，但项目总览与最终口径仍以 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md` 为准。

# ArcFlow Deployment Alignment And NanoClaw Stability Design

Date: 2026-04-16
Status: Draft for review

## Context

ArcFlow currently has a split between documented deployment topology and actual server runtime:

- The production server at `172.29.230.21` is running:
  - `arcflow-web` on port `80`
  - `arcflow-gateway` on port `3100`
  - `arcflow-plane-*` as a separate Docker Compose stack on port `8082`
  - `arcflow-nanoclaw` via PM2 in `/data/project/nanoclaw`
- `Dify` and `Weaviate` are not active in production.
- `Wiki.js` is not active in production, but old deployment scripts and docs still reference it.
- Production NanoClaw is online but has recent runtime errors:
  - stale or missing Claude Code session IDs
  - `EACCES` when unlinking IPC input files
  - `OneCLI gateway not reachable`

This creates two problems:

1. Operators can deploy or troubleshoot using stale instructions.
2. NanoClaw appears online while a key execution path remains unstable.

## Goals

1. Make the repository reflect the current deployment truth.
2. Define a single standard deployment entrypoint for current production.
3. Fix the identified NanoClaw stability issues in code and/or server configuration.
4. Verify the production stack after the fix with concrete checks.

## Non-Goals

- Re-architect the full ArcFlow deployment model.
- Reintroduce Dify, Weaviate, or Wiki.js.
- Implement new NanoClaw product features beyond what is required to restore stable operation.

## Approaches Considered

### Approach A: Repo alignment first, then production fix

Update documentation and deployment scripts to match reality, then debug and fix NanoClaw using the clarified topology.

Pros:

- Removes ambiguity before server changes.
- Lowers risk of fixing the right issue in the wrong runtime path.
- Leaves the repo in a recoverable state after the production fix.

Cons:

- Slightly slower than jumping directly into the server.

### Approach B: Production fix first, repo cleanup second

Pros:

- Fastest path to touching the live issue.

Cons:

- Easy to keep using outdated deploy assumptions.
- Higher risk of partial or non-repeatable fixes.

### Approach C: Server-only remediation

Pros:

- Minimal repo changes.

Cons:

- Guarantees drift remains.
- Future operators can recreate the same issue.

Recommended: Approach A.

## Design

### 1. Deployment Source Of Truth

After this work, the standard deployment model will be documented as:

- Root `docker-compose.yml` and root `deploy.sh` describe only the currently supported ArcFlow runtime that is actually used in production.
- `Plane` remains an independent stack under `setup/plane/`.
- `NanoClaw` remains a PM2-managed service on the server and is documented as such.
- `Dify`, `Weaviate`, and `Wiki.js` are treated as retired or legacy components, not active deployment dependencies.

The README, root deployment scripts, and `setup/` deployment scripts must tell the same story.

### 2. NanoClaw Debugging Scope

The runtime fix will focus only on the three observed failures:

- missing or stale Claude Code session handling
- IPC input file ownership/permission cleanup failure
- OneCLI gateway reachability from the agent runtime

The investigation will follow a root-cause-first path:

- confirm exact failing path from server logs
- inspect relevant NanoClaw process and container startup code
- add or use minimal diagnostics where needed
- implement one targeted fix per root cause

No unrelated refactors are included.

### 3. Testing Strategy

For repository behavior changes:

- add failing tests first for any NanoClaw behavior we change in code
- run focused tests for the touched packages
- rerun the existing repo test suites that cover the changed areas

For production verification:

- confirm `arcflow-web` HTTP `200`
- confirm `arcflow-gateway` `/health` HTTP `200`
- confirm Plane stack remains healthy
- confirm `arcflow-nanoclaw` is online under PM2
- confirm the prior NanoClaw error signatures stop recurring after restart and smoke verification

### 4. Risks And Mitigations

- Risk: server contains manual changes not in git.
  - Mitigation: inspect and preserve them before syncing or rebuilding.
- Risk: runtime issue is partly in NanoClaw repo, not ArcFlow repo.
  - Mitigation: treat `/data/project/nanoclaw` as an active sibling codebase and fix there if evidence points to it.
- Risk: production restart hides rather than fixes the issue.
  - Mitigation: use log-based before/after validation, not just process uptime.

## Deliverables

1. Updated repository docs and deployment scripts aligned to current production.
2. NanoClaw stability fix in the correct codebase and/or server configuration.
3. Verification notes with exact observed production state after remediation.

## Acceptance Criteria

- No active deployment doc or script claims that Wiki.js, Dify, or Weaviate are required for current production.
- The current production topology can be derived consistently from README and deploy scripts.
- NanoClaw no longer emits the previously observed `EACCES unlink` and stale session errors during smoke verification.
- Gateway, Web, Plane, and NanoClaw are all confirmed running after the fix.
