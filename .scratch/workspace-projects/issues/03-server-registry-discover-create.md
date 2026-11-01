# 03: The registry walks the Workspace and creates Projects

**What to build:** The server half of the feature. The registry stops being a fixed launch list and
becomes three producers over one rule — a Project is a registered directory:

1. `--project` paths, resolved at launch, kept in typed order.
2. Directories created through `CreateProject` in this process.
3. Discovery: the walk of the workspace that runs on every `ListProjects` request and registers every
   directory holding a `.git` entry.

Rules, all settled in the spec and ADR 0012:

- The registry is memory-only. A path whose directory is gone drops out; nothing is persisted and there
  is no delete action.
- Zero Projects is valid. Only a *named* Project that is not registered is refused, as `UnknownProject`.
- Discovery: `stat` for a `.git` entry (a directory, or a file as worktree and submodule checkouts have
  it), never execute git. Prune dot-directories and the inside of `.git`; do not follow symlinked
  directories; no depth cap; the workspace root itself is a candidate. Nesting is allowed.
- Dedupe by absolute `realpath`, so a Project named by a flag and found by the walk is one row.
- Ordering: flag Projects first in typed order, then created and discovered Projects by the Project
  directory's mtime, newest first, tie-broken by path. mtime is re-read on every walk.
- Creation: `name` joined to the workspace, one path segment — refused when empty, when it contains
  `/` or a NUL, when it is `.` or `..`, when it starts with a dot, and when the path exists as a
  regular file. An existing unregistered directory is registered rather than refused. A registered
  name is `ProjectExists`. No version-control command runs. A failure after `mkdir` removes the
  directory it just made. With no workspace configured, `NoWorkspace`.
- `ListProjects` answers with the fresh walk; `CreateProject` answers `ProjectCreated` on the asking
  socket and pushes a fresh `ProjectsMessage` to every other connected socket. A create registers a
  Project that a following `ListSessions`/`CreateSession` accepts at once.
- The Session pool, the Bridge, the transport and the file routes are untouched.

**Files:** the server's project registry and a new discovery/creation module beside it, the server's
message handler and registry construction, and a new backend spec. Do not touch the launcher, the
protocol package or the client.

**Blocked by:** 01, 02.

**Status:** open

- [ ] A workspace with a `.git` directory two levels down, one at the root, and one inside `node_modules`
      and inside a dot-directory: only the first two are served
- [ ] A `.git` **file** (worktree/submodule shape) marks a Project
- [ ] A symlinked directory inside the workspace is not followed
- [ ] Nested Projects are both served; an explicit `--project` inside the workspace appears once
- [ ] The list is flag Projects in typed order, then derived Projects newest mtime first, ties by path
- [ ] Zero Projects answers an empty list with the workspace named, and starts no Pi child
- [ ] A registered Project whose directory is deleted leaves the next list
- [ ] Create: makes the directory, registers it, and a Session then starts in it (the acceptance spec)
- [ ] Create: each refusal rule returns its typed code, `ProjectExists` for a registered name, and an
      existing unregistered directory is registered instead
- [ ] Create with no workspace configured is `NoWorkspace`
- [ ] A second socket receives the pushed `ProjectsMessage` after another socket creates
- [ ] Existing backend and e2e specs still pass untouched, including servers started with only a
      Projects list and no workspace
