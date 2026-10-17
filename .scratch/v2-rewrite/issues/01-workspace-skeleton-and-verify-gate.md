# 01: Workspace skeleton and verify gate

**What to build:** A fresh checkout installs and `npm run verify` passes. Six workspace packages exist (protocol, server, client, bridge-extension, scripted-provider, e2e), the pi version is pinned exactly, and the gate runs in order: typecheck (tests included), lint and format, store/component tests, build, e2e. Hygiene rules: a ticket ID or date in a comment fails the gate; a file over 400 code lines or a high comment ratio is a lint warning only.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] `npm ci && npm run verify` passes from clean
- [ ] One trivial passing test exists in each of the two test layers (ADR 0005)
- [ ] A comment containing a ticket ID or date makes verify fail; an oversize file or high comment ratio only warns
- [ ] pi is pinned to an exact version and tests use that one, not whatever is on PATH

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.
