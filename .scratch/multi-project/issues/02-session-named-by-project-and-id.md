# 02: A Session is named by its Project and its id

**What to build:** The core path — list a Project's Sessions, create one there, open it, prompt it, abort it, and receive its live state — addresses a Session by one composite value pairing its Project with its id, replacing the bare id. Listing Sessions and creating a Session name a Project, and the Sessions response names the Project it lists. The server resolves a Session only inside the named Project: a pair whose Project is not served, or whose id that Project does not hold, is a protocol error, and the server never searches another Project. The pool's id map is keyed by the pair, the absolute Session file stays canonical within its Project, and a connection watches one Project's list and one Session. Only that Project's Sessions, their activity, and that Session's Deltas are pushed to the connection. The Projection stops carrying a working directory; the Project comes from the pair on the message that carries it.

The client routes Snapshot, Delta, Settings, Commands, ContextUsage and session-scoped errors by the pair alone. It selects the Project from `?project=` when the registry serves it, otherwise the only or first Project. There is no picker yet. The remaining Session commands are converted in 03; until then they resolve against the connection's watched Project rather than searching.

**Blocked by:** 01 (the ordered Project registry).

**Status:** resolved

- [x] One composite Project+id value replaces the bare id on listing, creation, subscribe, prompt, abort and every response on the watched-Session path
- [x] Listing and creating Sessions name a Project, and a fresh Session is created in that Project
- [x] The Sessions response names the Project whose list it carries
- [x] A pair naming an id from another served Project is refused as a protocol error, and nothing is searched
- [x] The pool is keyed by the pair; a Session file remains canonical within its Project
- [x] A connection is pushed only its watched Project's Session list and activity
- [x] A run started in one Project keeps running while another Project is viewed
- [x] `Ctrl-C` stops every Pi child across every Project
- [x] The Projection no longer carries a working directory
- [x] The client store routes the watched-Session messages by the pair alone
- [x] `?project=` opens that Project when served; otherwise the only or first Project is selected
- [x] ADR 0007's eviction rule and 120 s window are unchanged, proved by the existing injected-clock eviction specs
- [x] End-to-end specs cover per-Project listing, creation, opening, prompting, no cross-Project activity, and the rejected cross-Project pair
- [x] Store and component tests are migrated to the composite identity for the messages this ticket converts

## Comments

Merged as `6233d88d5422165a4c9a8fc4ea0689bdcccc5022` (`git merge --no-ff` of
`pi-agent-6804fcf7-b886-428`, commit `fd9cbb2 Name a Session by its Project and id`), with no
conflicts; the branch was already based on the integration tip. What landed: `SessionRef {
project, id }` in `packages/protocol/src/model.ts` replaces the bare `sessionId` on `subscribe`,
`prompt`, `abort`, and on `sessionCreated`, `snapshot`, `delta`, `settings`, `commands`,
`contextUsage` and session-scoped `error`, while `listSessions`, `createSession` and the `sessions`
answer carry a bare `project`. `validate.ts` has one `requireSession`/`requireProject` pair, so a
frame carrying only `sessionId` fails as `MalformedPayload`. `SessionProjection` lost `cwd`, and
the pool keys hosts by the pair (`hostsByPair`) while keeping `hostsByFile` canonical, with
`hostFor` resolving through `SessionManager.findById` in the named Project only (an id it does not
hold is `UnknownSession`; an unserved path is `UnknownProject`) and `activityById(project)`
filtering. A socket keeps `watchedProject`, detaches the watched Session when the Project changes,
and `scheduleSessionsPush(project)` reaches only the sockets watching that Project. The transport
holds `activeProject`/`activeSession` and filters Snapshot and Delta by the full pair; the store
routes every converted message by the pair it carries, and `projects.svelte.ts` picks the linked
`?project=` when served and otherwise the first served Project. The not-yet-converted Session
commands resolve against the connection's watched Project and never search the registry. No
post-merge fixes to the merged code were needed. The one post-merge commit, `a2b8288`, adds the
e2e case the ticket asks for and the branch was missing: a connection watching one Project receives
no other Project's `sessions` push (verified to fail when the push filter is removed). The full gate
`npm run verify:full` passed on the integration branch: typecheck (all packages, tests included),
lint and format check, 182 store/component tests, build, and the sharded end-to-end suite, 144 tests
across two shards (72 + 72) with every test accounted for and none failed, flaky or skipped.
