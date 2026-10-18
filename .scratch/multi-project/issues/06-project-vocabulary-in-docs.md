# 06: Project vocabulary lands in the docs

**What to build:** The README launcher section describes `--project` and the one-server, one-URL model. The user guide's launcher flags and its “Running several projects” section are rewritten for one server, a Project picker, `?project=` and no second port or second Caddy site. The glossary and ADR 0008 are audited so `cwd` survives only as the string handed to `spawn`, and no user-facing document still presents one server per Project as the way to work. The deployment story remains one origin, one port and one allowlist.

**Blocked by:** 01, 02, 03, 04 and 05 (the documented behaviour must exist).

**Status:** resolved

- [x] The README documents `--project`, the picker and `?project=`
- [x] The guide's flag table describes `--project` as repeatable
- [x] The guide's “Running several projects” section describes one server and one URL
- [x] No user-facing doc presents `--cwd` or one server per Project as the way to work
- [x] The glossary and ADR 0008 remain the vocabulary and decision record
- [x] The Caddy, port and allowlist guidance still describes one origin and one allowlist

## Comments

Merged as `a7bfe3a` (`Merge branch 'pi-agent-189a6072-e9e1-429' into
integration/multi-project`, merging `7993ed7`), with no conflicts. What landed is a docs-only pass over
six files. `README.md` now says `--project` is repeatable, that one server is one URL and one
WebSocket, that the browser opens on the picker, remembers the last Project and skips the picker when
only one is served, that `?project=<absolute path>` is how a bookmark lands in a repository, that the
start banner prints one `pi-my-ui: project <path>` line per Project, and that the download route takes
`project` and `path`. `docs/guide.md` carries the same model in §4, §5, a two-level drawer in §9, a
Project-rooted file panel in §13, a rewritten §14 "Running several Projects" with a repeatable
`--project` flag table, and §15/§16 unchanged in intent. `docs/deploy/caddy.md` gained §4.2 "More than
one Project" stating there is no second port, site or allowlist value, and keeps one site, one 443 and
one origin. `docs/deploy/service.md` keeps one unit serving every Project and the port-error and
`EADDRINUSE` sections. `docs/troubleshooting.md` says a second Project needs no port of its own and
treats the picker as the normal first screen. ADR 0008 was corrected where its prose disagreed with
the shipped code: "one Project is one cwd" became "one absolute path", and the e2e consequence now
describes a one-entry Project list instead of a renamed `cwd`.

Fact-checked against the build rather than the prose: `node packages/server/dist/cli.js --help` after
`npm run build` prints the same eight flags as the guide's table, with `--project <dir>` repeatable
and defaulting to the current directory, and no `--cwd`. `grep -rn -- "--cwd" README.md docs/
GLOSSARY.md` finds nothing; the only surviving `cwd` in those files is ADR 0008's deliberate "retired
as a domain noun" sentence. `grep -rn cwd` over source leaves only spawn-adjacent launch fields
(`PiChildLaunch.cwd`, `ScriptedPiLaunch.cwd`, `cwd: session.project`) and `process.cwd()`, which is
what that ADR sentence claims. The client matches the documentation: `config.ts` reads `?project=`,
`store/projects.svelte.ts` selects a remembered or linked Project and warns when the registry no
longer serves it, `projects/storage.ts` persists the choice, `SessionDrawer.svelte` carries the
switcher, and `launcher/run.ts` prints one banner line per Project. No user-facing document still
presents one server per Project as the way to work.

The full gate passed on the integration branch: `npm run verify:full` — [verify] PASSED, all 5 steps
green, `166/166` e2e tests accounted for across three shards in 57,127 ms. No mismatch between the docs
and the shipped behaviour was found, so no post-merge doc or code fix was needed; the closing commit
only edits this ticket.
