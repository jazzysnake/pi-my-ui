# 14: Transcript: markdown and notifications

**What to build:** Messages render markdown (headings, code blocks, tables) with wide blocks scrolling inside themselves without widening the page; a message's raw markdown can be copied; notifications appear in the transcript.

**Blocked by:** 06 Send a message and stream the reply

**Status:** resolved

- [ ] E2E: headings, code and tables render
- [ ] A wide block does not cause horizontal page scroll
- [ ] Copy-raw puts the original markdown on the clipboard
- [ ] Notifications render in the transcript

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.
