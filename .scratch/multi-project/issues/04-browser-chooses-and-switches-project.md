# 04: The browser chooses and switches a Project

**What to build:** The first screen is the Project picker when nothing is remembered. Choosing a Project takes one tap and lands on its Sessions; the last choice is remembered on the device, and `?project=<absolute path>` opens it directly. A remembered or linked Project the server no longer serves shows the picker with a warning-coloured notice naming the path. A server with exactly one Project skips the picker. The drawer becomes Projects → that Project's Sessions, with the switcher always reachable. Labels disambiguate same-named folders by adding parent segments. A Project with no Sessions opens to an empty transcript with New Session available, and the live list updates without a reload. Two devices on different Projects do not disturb each other, and a Session from Project A remains openable after switching to B.

Until file requests are scoped to a Project, a multi-Project server keeps the folder control disabled rather than showing another Project's files.

**Blocked by:** 02 and 03 (the Project picker must not land on a half-converted client transport).

**Status:** claimed

- [ ] First load with nothing remembered shows the picker
- [ ] Choosing a Project is one tap and shows only that Project's Sessions
- [ ] The last Project is remembered on the device
- [ ] `?project=` opens that Project directly
- [ ] An unserved remembered or linked Project shows the picker and a warning notice naming the path
- [ ] A registry of exactly one Project skips the picker
- [ ] The drawer lists Projects, then the chosen Project's Sessions, with the switcher always reachable
- [ ] Two Projects sharing a last path segment get distinct labels
- [ ] A Project with no Sessions opens to an empty transcript with New Session available
- [ ] Sessions starting or settling appear in the live list without a reload
- [ ] A run in the Project left behind keeps running
- [ ] A Session from Project A is still openable after switching to Project B
- [ ] Two devices watching different Projects do not change each other's view
- [ ] A multi-Project server does not expose another Project's files before the file ticket lands
- [ ] Store and component tests cover URL parsing, remembering, the warning notice, label disambiguation and the single-Project skip
- [ ] End-to-end specs cover picker, switching, run survival, reopening across Projects and two-device independence
