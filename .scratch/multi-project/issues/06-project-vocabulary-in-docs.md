# 06: Project vocabulary lands in the docs

**What to build:** The README launcher section describes `--project` and the one-server, one-URL model. The user guide's launcher flags and its “Running several projects” section are rewritten for one server, a Project picker, `?project=` and no second port or second Caddy site. The glossary and ADR 0008 are audited so `cwd` survives only as the string handed to `spawn`, and no user-facing document still presents one server per Project as the way to work. The deployment story remains one origin, one port and one allowlist.

**Blocked by:** 01, 02, 03, 04 and 05 (the documented behaviour must exist).

**Status:** claimed

- [ ] The README documents `--project`, the picker and `?project=`
- [ ] The guide's flag table describes `--project` as repeatable
- [ ] The guide's “Running several projects” section describes one server and one URL
- [ ] No user-facing doc presents `--cwd` or one server per Project as the way to work
- [ ] The glossary and ADR 0008 remain the vocabulary and decision record
- [ ] The Caddy, port and allowlist guidance still describes one origin and one allowlist
