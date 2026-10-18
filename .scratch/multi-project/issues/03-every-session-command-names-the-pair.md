# 03: Every Session command names the pair

**What to build:** Complete the composite identity across the remaining session-scoped commands in both directions: bash, model, thinking level, automatic compaction, compact, statistics, rename, export, fork messages, fork, clone, tree, move leaf, reconnect, subagent steering and subagent transcript, together with the responses they produce. A bare id is no longer accepted anywhere, and the temporary resolution against the connection's watched Project is removed. Fork and clone create their new Session in the same Project, and the client opens it there. Rename refreshes only that Project's list, and export writes inside that Project.

**Blocked by:** 02 (the composite identity and core path).

**Status:** resolved

- [x] Every remaining session-scoped request carries the composite Project+id value
- [x] Every response to those requests echoes the pair
- [x] A session-scoped message carrying a bare id is refused as a protocol error
- [x] No Session command can resolve an id outside the Project it names
- [x] Fork and clone create the new Session in the source Session's Project, and the client opens it there
- [x] Rename refreshes only the owning Project's Session list
- [x] Export writes inside the owning Project
- [x] Tree, move leaf, reconnect, steering and subagent transcript work through the pair
- [x] The client transport and store send the pair and route every response by it
- [x] No temporary bare-id path or watched-Project fallback remains
- [x] End-to-end specs exercise each command group in a served Project
- [x] Store and component tests are migrated to the pair for every converted message

## Comments

Merged as `5525363` (`git merge --no-ff` of `pi-agent-7d394b07-c84e-4b1`, commit `a36f76d Name every
Session command by its Project and id`), with no conflicts; the branch was already based on the
integration tip `eea6785`.

What landed: `bash`, `setModel`, `setThinkingLevel`, `setAutoCompaction`, `compact`,
`getSessionStats`, `setSessionName`, `exportSession`, `reconnect`, `getForkMessages`, `forkSession`,
`cloneSession`, `getTree`, `moveLeaf`, `steerSubagent` and `getSubagentTranscript` now carry
`session: SessionRef`, and `sessionStats`, `sessionExported`, `sessionRenamed`, `forkMessages`,
`sessionForked` (with `sourceSession` naming the Session that asked), `sessionTree`, `leafMoved` and
`subagentTranscript` echo it. `requireSessionId` is gone from `validate.ts`, so a frame carrying only
a bare `sessionId` fails as `MalformedPayload` for every one of those commands. `server.ts` dropped
the watched-Project fallback and the `named === undefined` branch: every session handler resolves
through `pool.hostFor(message.session)` and answers with the pair it was given. Fork and clone report
`{ project: host.session.project, id }`, so the created Session lands in the source Project and the
transport opens it there from the message's own pair instead of from `activeProject`. Rename pushes
only `host.session.project`'s list; export is pi's own write inside that Project's child. The tree,
subagent, commands and subagents slices compare Project and id through one local `sameSession`, so a
same-id frame from another Project is ignored rather than routed. The recorded fixture in
`packages/client/test/fixtures/recorded-server-messages.json` keeps `sessionId` only inside
`projection`, where it belongs.

The new e2e cases in `packages/e2e/test/multi-project.spec.ts` cover the refusal of all sixteen bare-id
commands, fork and clone landing in the source Project's list and not the other's, rename refreshing
only its own Project's watchers, export writing inside its own Project and strictly outside the
other, tree and leaf move, reconnect, a settled subagent transcript read through the pair, and a
steer reaching an agent running in another Project. The store case in `message-tree.test.ts` feeds a
same-id tree and leaf move under a different Project and asserts neither is drawn.

Post-merge fixes on the integration branch: the implementer's two new doc comments sat above the
wrong declarations (`sameSession` in `subagents.svelte.ts`, and `AGENT_TEXT` in the e2e spec above
`BACKGROUND_SCRIPT`), so both were moved back onto what they describe. The full gate then failed on
its own wall budget rather than on any test: 152 tests, 152 passed, 68,094 ms against the 60,000 ms
promise, and the same overrun reproduced on the pre-merge tip `eea6785` (144/144 in 67,933 ms), so it
is not this ticket's eight specs. The gate's own remedy was applied: `DEFAULT_SHARDS` is three rather
than two, which runs the 152 tests in 56,485 ms with every test accounted for, and
`docs/measurements.md` records both runs. No test was weakened, skipped or deleted.

Full gate: `npm run verify:full` passed on the integration branch after those fixes - typecheck (all
packages, tests included), lint and format check, store and component tests, build, and the sharded
end-to-end suite, 152/152 tests across three shards (51 + 51 + 50), none failed, flaky or skipped.
