# 01: The launcher serves an ordered list of Projects

**What to build:** The owner starts one server with `--project <path>` repeated, or with no `--project` to serve the current directory exactly as today. Every path is resolved with `realpath`; a path that is not a readable directory, a duplicate after resolution, or a Project nested inside another served Project refuses startup with an error naming the offending path or paths. `--cwd` is removed, not aliased. `--help` describes `--project` as repeatable, and the healthy-start output prints one line per served Project. The server holds an immutable, ordered registry built once at startup, and a client can ask for it over the WebSocket; listing Projects starts no Pi child. Port, host, idle timeout, keep-alive, allowed-origin and health behaviour are unchanged.

Sessions and files still resolve against the first served Project, so the single-Project experience is unchanged until the Session identity and file tickets land. The README launcher example is updated in this ticket because it must not document a flag that no longer exists.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] `--project` is repeatable, and no `--project` serves the current directory
- [x] A path that is not a readable directory refuses startup with an error naming that path
- [x] Duplicate paths are rejected after resolving symlinks
- [x] A Project nested inside another served Project refuses startup with an error naming both
- [x] `--cwd` is gone from parsing, help and the README launcher example
- [x] `--help` describes `--project` as repeatable
- [x] The healthy-start output names every Project in command-line order
- [x] A Projects request returns the registry in command-line order and starts no Pi child
- [x] Port, host, idle-timeout, keep-alive and allowed-origin flags behave exactly as they do now
- [x] The health endpoint is unchanged
- [x] Launcher specs cover every refusal and the banner; a WebSocket spec covers the Projects response
- [x] Every e2e server start is migrated from one working directory to a Project list

## Comments

Merged as `137415bbc4f9bdccfe389507f777446ba8c97853` (`git merge --no-ff` of
`pi-agent-cf857f28-3b35-43e`, commit `15963cd Serve an ordered Project list from one server`), with
no conflicts; the branch was already based on the integration tip. What landed: `--project` is
repeatable and defaults to the current directory; every entry is `realpath`-resolved and checked for
readability, then refused if duplicated or nested (`resolveProject`/`resolveProjects` in
`packages/server/src/launcher/run.ts`); `--cwd` is gone from `FLAG`, `FLAG_SPECS`, parsing, help and
the README launcher section; the banner prints one `pi-my-ui: project <path>` line per Project in
command-line order. The server freezes the ordered list into `ProjectRegistry`
(`packages/server/src/projects.ts`) from the new `ServerConfig.projects`, exposes it as `primary` for
the not-yet-migrated Session and file paths, and answers `listProjects` with `projects` from the
registry before touching the pool, so no Pi child starts. All e2e server starts pass `projects:
[launch.cwd]`; the only remaining `cwd:` occurrences in `packages/e2e` are pi launch fields, seeded
session headers, `ScriptedPiLaunch.cwd`, and `spawn` cwds. `npm run verify:full` passed end to end on
the merge commit: typecheck, lint, format check, 175 unit tests, build, and 138 e2e tests across two
shards (69 + 69, zero failed, zero flaky). No post-merge fixes were needed. Client-side Project
selection, `SessionRef`, and the file-request rename remain for tickets 02-06.
