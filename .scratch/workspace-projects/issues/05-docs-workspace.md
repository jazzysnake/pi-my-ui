# 05: Documentation names the Workspace

**What to build:** Every user-facing document matches the new launcher surface and the new behaviour.
No document may claim that the working directory is served, or describe the flags as the only way to
get a Project.

- The README's launcher section: the `--workspace` example and its default, `--project` still
  repeatable, and the healthy-start banner including the workspace line.
- The guide's launcher flag table: the new row and the changed default. The guide's "what the app does
  not do" list loses any claim that Projects are fixed at launch, and gains the honest boundaries:
  creating is one directory inside the workspace, nothing outside it can be created, there is no
  rename or delete, and the registry is not persisted.
- The guide describes creating a Project from the browser and the discovery rule (a `.git` folder),
  in the guide's own voice, without contradicting ADR 0012.
- Deploy docs: only if they name `--project` in a way that is now wrong.

Keep the prose in the existing register: no marketing, no bullet-point padding, no restating the ADR.

**Files:** the README, the guide, and the deploy docs if they name the flags.

**Blocked by:** 01 (the flag names and defaults are settled there).

**Status:** resolved

- [x] The README shows a real command line including `--workspace`, and states what the default is
- [x] The guide's flag table has a `--workspace` row and no line that says the cwd is served
- [x] The guide explains discovery by `.git` folder and browser creation, including that the server
      runs no version-control command
- [x] No document promises deleting, renaming or persisting a Project

## Comments

Merged as `16fd460` (ticket commit `b2151b4`); `npm run verify:full` passed all 5 steps at `47ad7cf`. README, guide and deploy server doc now name `--workspace` and its default, the banner's workspace line, discovery by `.git`, browser creation inside the workspace, and the honest boundaries; `47ad7cf` restores that a repeated `--project` is refused at startup, which the ticket had dropped. Server-side discovery and creation land with 03.
