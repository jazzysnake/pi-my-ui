Status: ready-for-agent

# A Workspace registers Projects

Vocabulary is `GLOSSARY.md`; the decision record is
`docs/adr/0012-workspace-registers-projects-at-runtime.md`. Where this spec and that ADR disagree, the
ADR is right and this is the bug.

## Problem Statement

Adding work to the server means editing a command line. A phone user with a new idea has to reach a
laptop to pass another `--project`, restart the server, and pick up the new port or process on the
phone. Nothing that exists on disk and looks like a Project appears on its own either: a repository
cloned over SSH is invisible until the server is restarted with one more flag, on the machine the user
is not holding. The launch flags are a fixed allowlist in a system that is otherwise driven from a
phone.

## Solution

One `--workspace <dir>` names a directory the server is anchored to, defaulting to its own working
directory. Every Project registered inside it is served: registered means named by a `--project` flag,
created from the browser, or found by discovery — the walk that registers every directory holding a
`.git` folder. Creating a Project from the browser makes a directory inside the workspace and registers
it; the server runs no version-control command, so the new directory is empty and the user's next move
(git, another tool, or nothing) is theirs. Nothing outside the workspace is ever created, `--project`
keeps serving repositories outside it exactly as before, and a server with no Project at all is a
normal state rather than a startup error.

## User Stories

### A server anchored to a workspace
1. As the owner, I want to pass `--workspace <dir>` once, so that one root decides where Projects are
   found and where new ones can be made.
2. As the owner, I want `--workspace` to default to the process's working directory, so that
   `cd repo && pi-my-ui` keeps working without a flag.
3. As the owner, I want the working directory to be a default flag value and nothing more, so that no
   directory is ever served merely because the server was started in it.
4. As the owner, I want `--project <dir>` to keep working, repeatable and unchanged, so that a
   repository outside the workspace is still servable.
5. As the owner, I want two `--workspace` flags to be a usage error, so that "inside the workspace"
   never has two answers.
6. As the owner, I want a `--workspace` that is not a readable directory to refuse startup naming it,
   so that a typo is never a server that serves nothing.
7. As the owner, I want a Project found by the walk *and* named by `--project` to appear once, so that
   two routes to the same directory are one row.
8. As the owner, I want the nesting refusal gone, so that a walk that finds a repository inside a
   repository is not refused for doing its job.
9. As the owner, I want `--help`, the README and the guide to describe `--workspace` and the new
   default, so that the documented way to start the server matches the flags.

### Discovery
10. As a phone user, I want every directory under the workspace that holds a `.git` folder to appear
    as a Project, so that work I created elsewhere shows up without a restart.
11. As a phone user, I want discovery to look only for the `.git` folder and never run git, so that
    what makes a Project does not depend on a tool being installed.
12. As a phone user, I want the workspace walked whenever I ask for the Projects list, so that a
    repository cloned over SSH appears the next time I open the app.
13. As a phone user, I want dot-directories and the inside of `.git` folders skipped, and no symlinked
    directory followed, so that the walk is bounded by the tree I meant.
14. As a phone user, I want nested Projects served rather than hidden, so that a vendored checkout or
    submodule is usable on its own.

### Creating a Project
15. As a phone user, I want a New Project action wherever I choose a Project, so that I can start work
    without a laptop.
16. As a phone user, I want creating to make one directory directly inside the workspace, so that the
    action cannot produce a tree I did not ask for.
17. As a phone user, I want the server to make the directory and nothing else, so that version control
    is my choice and not the server's.
18. As a phone user, I want a created Project to be selectable at once, so that the new directory is
    usable from the phone that made it.
19. As a phone user, I want a name that is refused to say why in the sheet I typed it in, keeping what
    I typed, so that I can correct it without starting over.
20. As a phone user, I want a name that already exists as an unregistered directory to register it
    instead of failing, so that a restart does not cost me a directory I already made.
21. As a phone user, I want creating a Project to create no Session, so that the empty Session list is
    the screen I land on.

### Zero Projects and departing ones
22. As a phone user, I want a server with no Project to show an empty picker that explains what a
    workspace is and offers creation, so that a fresh workspace is a starting point and not a dead end.
23. As a phone user, I want a Project whose directory disappeared to leave the list, so that the list
    tells me what exists.
24. As a phone user, I want a browser looking at a Project that left to land on the picker with a
    warning naming the path, so that I am told why the app opened empty.
25. As a phone user, I want a Session whose directory disappeared to keep running until its child
    exits, so that a rename on another machine does not kill work in progress.

## Implementation Decisions

**Flags.** `--project` is untouched: repeatable, `realpath`-resolved, launch order preserved. The only
change to it is that the nesting refusal is deleted. `--workspace <dir>` is new, accepts at most one
occurrence, resolves like `--project`, must be a readable directory, and defaults to the process's
working directory. Switching the working-directory default from "serve it" to "anchor it" is the one
behaviour change to the bare `pi-my-ui`.

**Registry.** A Project is a registered directory. Three producers: launch flags, creations in this
process, and the last walk. The registry is memory-only and rebuilt per process; there is no file and
no delete action, because the filesystem is the authority over what exists. A path whose directory is
gone drops out. Zero Projects is valid; the surviving refusal is that a *named* Project which is not
registered is a typed error and never a fallback. Registration is by absolute `realpath`, so the three
producers dedupe to one entry per directory.

**Discovery.** Walk the workspace on each `ListProjects` request; cache nothing. A directory is a
Project when it holds a `.git` entry (a directory normally, a file for worktree and submodule
checkouts), found by `stat`, never by executing git. Prune dot-directories and the inside of `.git`;
do not follow symlinked directories; no depth cap. The workspace root itself is a candidate. Nesting is
allowed.

**Creation.** `CreateProject` carries a name, never a path. The server joins it to the workspace and
requires a single path segment: not empty, no `/`, no NUL, not `.` or `..`, no leading dot (discovery
prunes dot-directories, so such a directory could never be found by both routes). An existing regular
file at that path is refused. No length limit is invented; the OS error is reported. If the directory
is absent it is created; if it exists and is unregistered it is registered; if it is registered the
request is refused. No version-control command runs. A failure after `mkdir` removes the directory it
just made, so a half-made Project never appears.

**Ordering.** Explicit `--project` entries first, in typed order; then created and discovered
Projects, sorted by the Project directory's modification time, newest first, tie-broken by path. The
walk re-reads mtime each time, so the derived half is never stale.

**Protocol.** `CreateProject { name }` from the client. `ProjectCreated { project }` answers it and
carries no list: the creating client re-asks with `ListProjects`, so no message holds two versions of
the same state. Other connections watching are pushed a fresh `ProjectsMessage`. `ProjectsMessage`
gains `workspace: string | null`, which is the only signal a client needs to know whether creation is
possible. New error codes: `NoWorkspace`, `InvalidProjectName`, `ProjectExists`. `UnknownProject`
keeps meaning "this server does not serve that Project". The transport, the Snapshot/Delta model, the
Bridge, the origin allowlist and the health endpoint are untouched.

**Client.** A create control in the picker's header and in the drawer's project level, and an empty
state for zero Projects that names the workspace and offers it. Tapping it opens a name sheet;
success selects the new Project and lands on its empty Session list with New Session available; a
refusal shows one line in the sheet, keeps it open, keeps the typed name. Selection waits for the
Projects answer that follows the create, so the chosen Project is always one the client has in hand.
The folder control stays disabled with no Project chosen, as today. Labels are unchanged: the shortest
absolute-path suffix that is unique among served Projects.

## Testing Decisions

**Backend suite proves the journey.** A good test here drives the real server over a real socket and
asserts on what a client can observe, never on registry internals, and never by reaching into the walk
or the filesystem helper directly. Creating a Project needs a real `mkdir`, a real walk and a real
registry, so the acceptance spec starts the real server against a real temporary workspace and asserts
what a client sees: create a name, see it in the Projects answer, start a Session in it, and see the
Session listed. The same suite covers: a name that is refused (each rule separately, with the typed
code), an existing unregistered directory being registered, an existing file being refused, a
`.git`-marked directory two levels down being discovered, a dot-directory and the inside of `.git`
being skipped, a symlinked directory not being followed, nested Projects both being served, an explicit
`--project` inside the workspace appearing once, the derived group ordered by mtime with the typed
group first, a Project whose directory is deleted leaving the list, and a `ListProjects` on a workspace
with nothing in it answering an empty list with the workspace named. Prior art is the existing backend
specs that start the real server and drive it with a socket client.

**Launcher cases.** Two `--workspace` flags, an unreadable `--workspace`, and a bare launch in a
plain directory (no Project, no error) run the launcher in-process, as the existing flag specs do.

**Store and component tests** cover the client's own rules without a server, fed typed server
messages as every existing store test is: the empty state, the name sheet's refusal line and its
retention, selection arriving with the following Projects answer, the create control's absence when the
workspace is null, and the existing picker warning for a Project that left.

**No new browser spec.** Per ADR 0009 the claim needs a real server, socket, filesystem and Pi child —
all of which the backend suite has with no browser — so creation earns a backend spec and the client
half is covered where it lives. If the name sheet grows behaviour only a real layout engine can
witness (soft keyboard, focus, viewport), that spec is admitted on the layout claim, not on creation.

**Fixtures.** The e2e harness's workspace holds no `.git`, so a fixture Project needs a marker to be
discovered. The 28 spec files that pass a Projects list are not touched: `--project` still means what
it meant.

## Out of Scope

- Running `git init` or any other tool at creation; choosing version control is the user's.
- Registering, renaming or deleting a directory from the browser beyond creating one; deleting a
  Project is a filesystem action.
- Persisting the registry across restarts, and any "recent Projects" view.
- Serving anything outside the workspace that was not named with `--project`.
- A per-client or per-user view: every connection sees the same workspace and the same Projects.
- Any cross-Project view: recent Sessions across Projects, cross-Project search, a combined file tree.

## Further Notes

**Seams.** No new seam. Discovery and creation both enter through the existing server boundary —
discovery happens when a client asks for the Projects list, and creation is a protocol message that
makes one directory — so there is no exported walk or filesystem function with its own test-only entry
point. The launcher seam already exists for flags, the store seam already exists for client rules, and
neither the walk nor the create is reachable from a test except the way a client reaches it.

**No privilege gate on creation, and why.** The launch flag used to be the whole allowlist. It is not
the only way to widen what the server serves any more, so the question is what a client gains: nothing
it did not already have, because any client can send a shell command through pi and run it inside a
Project, where `mkdir` was already one keystroke away. Creation is bounded more tightly than that — one
path segment, joined by the server, inside the workspace. The full argument and the rejected
alternatives (a create flag, a token, `git`-based detection, automatic `git init`, a persisted
registry, a capped walk) are in ADR 0012.

**Documentation rides with the parser.** The `--help` text is rendered from the flag definitions, and
the README launcher example and the guide's flag table both name the current default. They are edited
in the same change that adds the flag, never ahead of it, so no document describes a flag the build
does not parse.

**Known rough edge, accepted.** Ordering the derived Projects by directory modification time is
uniform and cheap, but a directory's mtime moves when entries are added, removed or renamed inside it —
not when files change further down, and not on commits — so the order is a rough recency, not the truth
about where work happened. A workspace root that is itself a Project is lifted to the top whenever
anything is created in the workspace. Both are recorded rather than fixed; the alternatives need git,
or Session activity, and so order only some Projects.
