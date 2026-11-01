# A Workspace registers Projects, including at runtime

Status: accepted

ADR 0008 made the launch flag the whole allowlist, and ended by saying that adding a Project from the
browser "would reopen that boundary and needs its own trust design". This is that design. The server
now takes one `--workspace <dir>` root (defaulting to the process's working directory) alongside the
unchanged, still-repeatable `--project`; every registered directory inside the workspace is a Project,
registered either by a flag, by a create from the browser, or by discovery — the walk of the workspace
that registers any directory holding a `.git` folder. A freshly created Project is an empty directory,
not a repository: the server runs no `git init` and no other tool, so the choice of version control
stays where it was.

## Why the boundary is not reopened

The launch flag bounded *which* files the server serves, and it was the only way to widen that set.
It is no longer the only way, so the question is what a browser client can now reach. The answer is
nothing it could not reach before: any client can already send a `Bash` message and have shell run
inside a Project (`packages/server/src/live-bash.ts`), so `mkdir newdir` was already one command away,
and create is bounded more tightly than that — one path segment, joined by the server to the workspace
root, refused outside it. A gate on creation would guard a door bash already opens, at the cost of a
deployment change on every install, so creation is allowed whenever the server is reachable. What
remains true from ADR 0008: an explicit `--project` is still launch-only, still the way to serve a
repository that is *not* inside the workspace, and still an allowlist the browser cannot extend.

## Considered options

- **A `--allow-create` flag, or a shared token.** Rejected: the same client can already write to the
  same directories through `!` bash, so the gate protects nothing verifiable, while making the
  feature absent by default on every existing install.
- **Detecting a repository by running `git rev-parse --show-toplevel`.** Rejected: one spawn per
  candidate directory makes a walk over a real workspace unusably slow, and it would tie "is a
  Project" to git, which the domain does not want — a Project is a registered directory, and `.git`
  is only what the automatic route looks for.
- **Running `git init` when creating.** Rejected by the owner: it rules out other version-control
  choices and makes creation do more than the user asked. The phone flow stays complete anyway,
  because the created directory is a Project immediately, so `git init`, `svn init` or nothing at all
  can be run inside it through the same client.
- **Persisting the registry to a file under the workspace.** Rejected: a third source of truth that
  drifts from the filesystem and needs pruning, a delete action and a rule for whether discovered
  Projects are written down. The registry is instead memory-only — flags, plus this process's
  creations, plus the last walk — so the filesystem stays the single authority over what exists, at
  the honest cost that a restart forgets a created directory that still has no `.git` folder. One tap
  recovers it, because creating a name that already exists as an unregistered directory registers it
  instead of refusing.
- **Walking the workspace once at startup, or caching the walk.** Rejected: discovery exists so that a
  repository created over SSH appears without a restart, and the walk is asked for exactly when it
  matters — when a client asks for the Projects list.
- **Capping the walk's depth.** Rejected: pruning dot-directories already bounds it, and a cap would
  silently hide a Project four levels down, which is worse than a slow first paint.

## Consequences

- **A Project and a git root are no longer the same set.** A registered directory need not hold a
  `.git` folder — created Projects start without one, and `--project` never required one — while
  discovery registers only directories that do. Every rule that used to be phrased about repositories
  is phrased about registration.
- **Projects may nest.** ADR 0008's no-nesting rule is dropped outright, not narrowed: a walk finds
  nested repositories by construction (submodules, vendored checkouts), so refusing them would refuse
  what discovery exists to find. The containment check is unchanged and still takes exactly one named
  Project root per request, so a file request cannot name two roots; the accepted consequence is that
  Project A's file panel can read files of Project B that lives inside A. Both are inside the
  workspace, and a shell in A could already reach them.
- **Nothing registers a directory implicitly.** The `--workspace` default is a default flag value,
  like `--port 8787`; it never means "serve the cwd". Running in a repository serves it because the
  walk finds `.git` at the root, and running in a plain directory serves nothing until a Project is
  created.
- **Zero Projects is a valid server**, and the normal first-run state of a fresh workspace. ADR 0008's
  registry refused an empty list; the narrower rule survives — a *named* Project that is not served is
  a typed refusal, never a fallback to another Project.
- **The list has two orders.** Explicit `--project` entries keep the order they were typed, because
  that guarantee is the user's; everything else — created and discovered — is sorted by the Project
  directory's modification time, newest first, tie-broken by path. That ordering is uniform and cheap
  but imperfect: a directory's mtime moves when entries are added, removed or renamed in it, not when
  files change below it and not on commits, and a workspace root that is itself a Project is lifted to
  the top whenever anything is created in the workspace. The alternatives — git's HEAD mtime, or
  Session activity — order better but only for some Projects.
- **One create fans out.** The creating device is answered with the new path alone and re-asks for the
  list, so no message carries two versions of the same state; every other connected device is pushed
  the fresh list.
- **A departed Project is a short list, not an error.** A registered path whose directory is gone —
  deleted, renamed, unmounted — stops being served, drops out of the list, and leaves a browser
  looking at it on the path that already exists: the picker with the warning naming the path. A
  Session whose directory vanished keeps receiving deltas until its Pi child exits, because the child
  holds its own working directory and nothing re-checks the path.
- **Project labels ignore the workspace.** A row still shows the shortest absolute-path suffix that is
  unique among served Projects, which already renders `work/api` against `oss/api`. A workspace-relative
  label would read shorter but leave explicit Projects outside the workspace without a relative form,
  so the label rule would have to switch on membership.
- **Test fixtures gain a marker.** The e2e harness's workspace contains no `.git` anywhere
  (`packages/e2e/src/pi-harness.ts`), so a fixture Project needs one to be discovered. The 28 spec
  files that pass `projects:` are untouched: `--project` still means what it meant.
- **Visibility is optional.** Nothing in the UI has to show the workspace; `ProjectsMessage` gains
  `workspace: string | null` only so a client knows whether creating is possible at all.
