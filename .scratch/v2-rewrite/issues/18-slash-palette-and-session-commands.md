# 18: Slash palette and session commands

**What to build:** Typing `/` opens a fuzzy palette of built-ins, prompt templates and server commands. Choosing a row inserts the command and does not run it; tap, Enter and Tab all complete. Built-ins route to app behaviour: /new, /resume, /model, /thinking, /name, /session, /export. pi's TUI-only commands are refused with a message; any other slash text is sent to the agent as written.

**Blocked by:** 17 Composer controls, 10 Sessions: list and switch

**Status:** resolved

- [ ] E2E: palette lists, filters, and inserts without sending
- [ ] TUI-only commands refused, never sent to the model
- [ ] /name renames, /session shows stats, /export downloads HTML, /new creates a Session
- [ ] Unknown slash text reaches the agent as written

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.
