# 02: Create-a-Project and the workspace on the wire

**What to build:** The protocol contract for the whole feature, in the protocol package only:

- `CreateProject` as a client message carrying `name` — a name, never a path.
- `ProjectCreated` as a server message carrying `project`, the created absolute path. It carries **no**
  list: the creating client re-asks with `ListProjects`.
- `ProjectsMessage` grows `workspace: string | null`, null when the server was started without one.
  That field is the only signal a client needs to know whether creating is possible.
- Three error codes: `NoWorkspace` (a create with no workspace configured), `InvalidProjectName` (a
  name the server refuses), `ProjectExists` (the name is already a registered Project). `UnknownProject`
  keeps its meaning.
- The new client message is parsed and validated at the boundary like every other one, so a missing or
  non-string `name` is a `MalformedPayload` refusal rather than a TypeError.

Keep the client compiling: if a client switch or map over server message types needs a case, add the
minimal one. Do not add the transport's send method or any store behaviour — ticket 04 owns those.

**Files:** the protocol package's messages, constants, errors and validators. Nothing else.

**Blocked by:** None. Start now.

**Status:** resolved

- [x] `CreateProject` and `ProjectCreated` exist in the message unions, with their type discriminators
- [x] `ProjectsMessage.workspace` is `string | null`
- [x] `NoWorkspace`, `InvalidProjectName` and `ProjectExists` are in the closed error set
- [x] A `CreateProject` frame with a missing or non-string `name` is refused as `MalformedPayload`
- [x] Protocol and client typecheck pass; no store or transport behaviour is added

## Comments

- `cf4ebaa` — `npm run verify:full` green in a pristine worktree of the merge commit (5/5 steps: typecheck, lint+format, build, 25+13 test files / 222+48 tests, 85 browser tests); landed `createProject`/`projectCreated` on the wire, `ProjectsMessage.workspace` and the three refusal codes, plus the server's `workspace: null` answer and no-Session guard the compiler demanded.
