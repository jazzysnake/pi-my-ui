# 17: Composer controls

**What to build:** Input row of input, attach, branch, send/stop with send in the thumb corner. Enter inserts a newline; Ctrl/Cmd+Enter sends; Escape cancels a run (first Escape only closes an open palette). Image attachments with removable thumbnails. A While-running row offers Steer or Follow up with a caption. A status strip has model and thinking-level pickers and an auto-compact toggle that round-trips. A refused message shows an error line. The composer survives the on-screen keyboard and rotation.

**Blocked by:** 06 Send a message and stream the reply

**Status:** resolved

- [ ] E2E for each control above
- [ ] Attachment sent with a message reaches pi
- [ ] Steer and Follow up behave per their captions
- [ ] Refusal shows an error line and nothing is sent
- [ ] Layout holds with a shrunk (keyboard) viewport and after rotation

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.
