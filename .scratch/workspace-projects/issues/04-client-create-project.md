# 04: Creating a Project from the phone

**What to build:** The client half. It knows whether creating is possible, offers it, and lands the
user in the new Project.

- The projects slice learns the workspace from `ProjectsMessage.workspace`, and exposes whether the
  server can create. The create control is absent when it cannot (`null`), and with zero Projects the
  picker shows an empty state that names the workspace and offers the same action.
- A name sheet: one text field, a Create action, a Cancel. A refusal from the server renders as one
  line inside the sheet, the sheet stays open, and the typed name is kept. Failure codes map to
  ordinary sentences — never a JSON dump, never "internal error" for a name rule.
- On `ProjectCreated` the client does not trust a list it has not seen: it sends `ListProjects` and
  selects the new path when that answer arrives, then lands on that Project's Session list with New
  Session available. A created path that is missing from the answer is not selected.
- The create control sits in the picker header and in the drawer's project level, so it is reachable
  while a Project is already chosen.
- Transport gains one send method for the create, following how its other sends are written.
- Labels stay as they are: the shortest absolute-path suffix unique among served Projects.

**Files:** the client's projects store, transport, picker, drawer, shell and a new name-sheet
component, plus client store and component tests. Do not touch the protocol package or the server.

**Blocked by:** 02.

**Status:** resolved

- [x] `ProjectsMessage.workspace` is stored and exposed; the create control is absent when it is null
- [x] Zero Projects shows an empty state that names the workspace and offers Create
- [x] The sheet refuses nothing itself: it sends the name and renders the server's refusal, keeping the
      typed text
- [x] `ProjectCreated` triggers a `ListProjects`, and the new path is selected only when that answer
      contains it
- [x] The create control is reachable from the picker and from the drawer's project level
- [x] Store tests: empty state, workspace-null control, refusal line and retained text, select-after-
      answer, and no selection when the answer omits the path
- [x] Component tests render the sheet and the empty state; existing project, drawer and files tests
      still pass

## Comments

- Merged in `2ece59b` with no conflicts; `npm run verify:full` passed all 5 steps (85 browser tests,
  29.8 s of a 45 s budget). Landed: `workspace`/`canCreate`/`creating`/`createError`/`createdProject`
  on the projects slice, `createProject` on the transport (which asks for `ListProjects` on
  `ProjectCreated` before the store may select), `ProjectNameSheet.svelte`, the create control in the
  picker header and the drawer's Project level, the zero-Project empty state, and 223 lines of tests.
  The empty-state and workspace-null cases live in the component block of `projects.test.ts` rather
  than the store block, per the two-layer test policy; the coverage the box asks for is all there.
