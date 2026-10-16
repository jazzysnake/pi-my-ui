# 19: Bash mode

**What to build:** A message starting with `!` or `!!` shows which mode it is in before sending: `!` adds output to context, `!!` does not. Output streams live in a card with exit code, and the card survives a resync.

**Blocked by:** 17 Composer controls

**Status:** ready-for-agent

- [ ] E2E: indicator shows for each prefix before send
- [ ] Live output streams while the command runs
- [ ] Exit code shown; card survives a resync
- [ ] `!!` output never enters model context
