# 01: The launcher is anchored to a Workspace

**What to build:** A new `--workspace <dir>` flag, at most one occurrence, defaulting to the process's
working directory. It resolves like `--project` — `realpath`, must be a readable directory, and a
failure refuses startup naming the path. A second `--workspace` is a usage error naming the flag, not
a last-one-wins. The resolved workspace reaches the server through its config, which grows an optional
`workspace` field (optional so a server can still be started without one, as every existing spec
does). The nesting refusal in the launcher's Project resolution is **deleted**; the duplicate refusal
stays. The start banner prints `pi-my-ui: workspace <path>` before the Project lines. `--project` is
otherwise untouched: repeatable, `realpath`-resolved, typed order preserved.

`--help` gains the flag from its one definition, described as where Projects are discovered, defaulting
to the current directory.

**Files:** the launcher's flag/args/run modules, the server config, and the launcher backend spec.

**Blocked by:** None. Start now.

**Status:** open

- [ ] `--workspace <dir>` resolves with `realpath` and refuses a path that is not a readable directory,
      naming it
- [ ] Two `--workspace` flags are a usage error; the flag also appears in `--help` and in the usage text
- [ ] With no `--workspace`, the resolved workspace is `processCwd` — and nothing is registered from it
- [ ] The workspace reaches the server config as an optional field
- [ ] Two `--project` values where one contains the other are accepted; duplicates still refused
- [ ] The banner names the workspace once, before the Project lines
- [ ] Launcher specs cover: two workspaces, unreadable workspace, the default, nested `--project`
      accepted, banner order

Do not assert on a server with zero registered Projects here: the registry refuses an empty list until
ticket 03. Assert the resolved configuration and the banner, which are this ticket's seam.
