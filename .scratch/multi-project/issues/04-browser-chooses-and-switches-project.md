# 04: The browser chooses and switches a Project

**What to build:** The first screen is the Project picker when nothing is remembered. Choosing a Project takes one tap and lands on its Sessions; the last choice is remembered on the device, and `?project=<absolute path>` opens it directly. A remembered or linked Project the server no longer serves shows the picker with a warning-coloured notice naming the path. A server with exactly one Project skips the picker. The drawer becomes Projects → that Project's Sessions, with the switcher always reachable. Labels disambiguate same-named folders by adding parent segments. A Project with no Sessions opens to an empty transcript with New Session available, and the live list updates without a reload. Two devices on different Projects do not disturb each other, and a Session from Project A remains openable after switching to B.

Until file requests are scoped to a Project, a multi-Project server keeps the folder control disabled rather than showing another Project's files.

**Blocked by:** 02 and 03 (the Project picker must not land on a half-converted client transport).

**Status:** resolved

- [x] First load with nothing remembered shows the picker
- [x] Choosing a Project is one tap and shows only that Project's Sessions
- [x] The last Project is remembered on the device
- [x] `?project=` opens that Project directly
- [x] An unserved remembered or linked Project shows the picker and a warning notice naming the path
- [x] A registry of exactly one Project skips the picker
- [x] The drawer lists Projects, then the chosen Project's Sessions, with the switcher always reachable
- [x] Two Projects sharing a last path segment get distinct labels
- [x] A Project with no Sessions opens to an empty transcript with New Session available
- [x] Sessions starting or settling appear in the live list without a reload
- [x] A run in the Project left behind keeps running
- [x] A Session from Project A is still openable after switching to Project B
- [x] Two devices watching different Projects do not change each other's view
- [x] A multi-Project server does not expose another Project's files before the file ticket lands
- [x] Store and component tests cover URL parsing, remembering, the warning notice, label disambiguation and the single-Project skip
- [x] End-to-end specs cover picker, switching, run survival, reopening across Projects and two-device independence

## Comments

Merged as `3605d86` (`git merge --no-ff` of `pi-agent-fc7c6fb3-30ad-454`, commits `816e950 Start
the Project picker and switch-on-tap flow` and `c4c1210 Finish the Project picker and switch-on-tap
flow`), with no conflicts; the branch was already based on the integration tip `4b2599f`.

What landed: `store/projects.svelte.ts` is the one owner of the served list, the chosen Project and
the notice, and `config.ts` reads `?project=` beside `?session=` and `?ws=`. On a `ProjectsMessage`
it chooses a linked or remembered Project the registry serves, chooses nothing and states the path
in `projects/storage.ts`'s remembered value or `config.project` when it is not served, and chooses
the only Project when the registry holds exactly one — so an unserved remembered or linked path
wins over the single-Project skip and the picker shows with the notice. `projects/labels.ts` derives
one label per Project from the last path segment, prepending parents until two labels differ, and
both the picker and the drawer render from it. `ClientStore.selectProject` clears the transcript,
sessions, settings, commands, subagents, context and tree before the new Project's list arrives;
`App.svelte` follows the store's choice into `transport.switchProject` and rewrites the address with
`projectAddress`, so a copied URL lands in the same Project. `transport.ts` watches a Project and a
`SessionRef` pair, filters Snapshot and Delta by the pair before moving the Cursor, and holds a
`?session=` id until a Project is chosen, which is what makes a Session from Project A open again
after switching to B. `SessionDrawer.svelte` became Projects then that Project's Sessions with the
switch control always present, the picker is a first-screen overlay, a Project with no Sessions
draws an empty transcript with New Session, and `Shell.svelte` keeps the folder control disabled on
a server serving more than one Project until file requests are scoped. Store and component cases in
`packages/client/test/projects.test.ts` cover URL parsing, remembering, the notice and its warning
tone, label disambiguation, the single-Project skip and pair routing; the new cases in
`packages/e2e/test/multi-project.spec.ts` cover the picker, a one-tap choice, a remembered and a
linked Project, both unserved notices, a single-Project server, an empty Project, a run surviving a
switch with and without a reload, a Session reopening across Projects and two pages on different
Projects leaving each other alone.

The full gate passed on the integration branch: `npm run verify:full` — [verify] PASSED, all 5 steps
green, `162/162` e2e tests accounted for across three shards in 56,386 ms. No post-merge fix was
needed and no test was weakened, skipped or deleted.
