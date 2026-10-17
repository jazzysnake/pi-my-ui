# 06: Send a message and stream the reply

**What to build:** Type a message, send, and watch the scripted reply and thinking stream in. Stop cancels a run. Error, abort and retry states (with attempt count) show in the transcript.

**Blocked by:** 05 Client shell: connect and render the transcript

**Status:** resolved

- [ ] E2E: send produces a streamed scripted reply
- [ ] Thinking blocks stream and the view auto-scrolls while streaming
- [ ] Send becomes stop during a run and stop aborts it
- [ ] Error, abort and retry (with attempt count) states render

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.
