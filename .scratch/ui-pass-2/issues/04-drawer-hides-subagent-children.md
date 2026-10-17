# 04: Drawer hides subagent child Sessions

**What to build:** The Session drawer keeps listing disk facts but no longer lists pi-subagents child
runs as Sessions. A listed Session is dropped only when it has a parent Session path and its name
ends with `#` followed by eight characters, the run-id shape pi-subagents gives a child. The owner's
own forks and clones stay listed, and a Session with either fact alone stays listed. The unread and
working overlays for the rows that remain are unchanged.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A directory holding an ordinary Session, an owner fork (parent set, no run-id name tail) and a
      subagent child (parent set, run-id name tail) lists the ordinary Session and the fork only.
- [x] A Session with a run-id-shaped name but no parent path stays listed.
- [x] A Session with a parent path but no run-id-shaped name tail stays listed.
- [x] The unread and working state of every remaining row is unchanged.
- [x] If pi's listing stops reporting a parent path, no Session is hidden; the filter fails by
      listing an extra row rather than by hiding one.
- [x] An end-to-end drawer test covers the ordinary/fork/child directory; the existing drawer tests
      still pass.

## Comments

Resolved on `integration/ui-pass-2` by merge `e69d215`; the code-review follow-up is `f460a60`.
`subagent-child-session.ts` holds the shared shape (a parent Session path plus `#` and eight run-id
characters) and the `runIdPrefixOf` / `childRunIdPrefixOf` helpers; `sessions.ts` filters with it.
`subagent-drawer.spec.ts` proves the ordinary/fork/child directory and that either fact alone keeps
a row. Overlays are untouched: the filter runs before the client's row mapping, and the existing
client overlay tests still pass. A misclassification lists an extra row rather than hiding one.

