# 04: Drawer hides subagent child Sessions

**What to build:** The Session drawer keeps listing disk facts but no longer lists pi-subagents child
runs as Sessions. A listed Session is dropped only when it has a parent Session path and its name
ends with `#` followed by eight characters, the run-id shape pi-subagents gives a child. The owner's
own forks and clones stay listed, and a Session with either fact alone stays listed. The unread and
working overlays for the rows that remain are unchanged.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A directory holding an ordinary Session, an owner fork (parent set, no run-id name tail) and a
      subagent child (parent set, run-id name tail) lists the ordinary Session and the fork only.
- [ ] A Session with a run-id-shaped name but no parent path stays listed.
- [ ] A Session with a parent path but no run-id-shaped name tail stays listed.
- [ ] The unread and working state of every remaining row is unchanged.
- [ ] If pi's listing stops reporting a parent path, no Session is hidden; the filter fails by
      listing an extra row rather than by hiding one.
- [ ] An end-to-end drawer test covers the ordinary/fork/child directory; the existing drawer tests
      still pass.
