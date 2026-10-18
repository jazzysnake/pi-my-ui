# 01: The launcher serves an ordered list of Projects

**What to build:** The owner starts one server with `--project <path>` repeated, or with no `--project` to serve the current directory exactly as today. Every path is resolved with `realpath`; a path that is not a readable directory, a duplicate after resolution, or a Project nested inside another served Project refuses startup with an error naming the offending path or paths. `--cwd` is removed, not aliased. `--help` describes `--project` as repeatable, and the healthy-start output prints one line per served Project. The server holds an immutable, ordered registry built once at startup, and a client can ask for it over the WebSocket; listing Projects starts no Pi child. Port, host, idle timeout, keep-alive, allowed-origin and health behaviour are unchanged.

Sessions and files still resolve against the first served Project, so the single-Project experience is unchanged until the Session identity and file tickets land. The README launcher example is updated in this ticket because it must not document a flag that no longer exists.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `--project` is repeatable, and no `--project` serves the current directory
- [ ] A path that is not a readable directory refuses startup with an error naming that path
- [ ] Duplicate paths are rejected after resolving symlinks
- [ ] A Project nested inside another served Project refuses startup with an error naming both
- [ ] `--cwd` is gone from parsing, help and the README launcher example
- [ ] `--help` describes `--project` as repeatable
- [ ] The healthy-start output names every Project in command-line order
- [ ] A Projects request returns the registry in command-line order and starts no Pi child
- [ ] Port, host, idle-timeout, keep-alive and allowed-origin flags behave exactly as they do now
- [ ] The health endpoint is unchanged
- [ ] Launcher specs cover every refusal and the banner; a WebSocket spec covers the Projects response
- [ ] Every e2e server start is migrated from one working directory to a Project list
