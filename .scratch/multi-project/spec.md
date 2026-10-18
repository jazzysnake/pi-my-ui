Status: implemented

# One server, many Projects

Vocabulary is `GLOSSARY.md`; the decision record is `docs/adr/0008-one-server-many-projects.md`. Where this spec and that ADR disagree, the ADR is right and this is the bug.

## Problem Statement

I drive `pi` from my phone, and I work in several repositories. Because the server owns exactly one working directory, a second repository means a second server process on a second port, with its own idle pool of Pi children and its own browser tab. Switching Projects is switching ports, which a phone makes awkward: no single URL to keep, no single homescreen shortcut, no way to see the other repository's Sessions without leaving the app I am in. Memory grows with the number of servers I left running rather than with the work I am doing.

## Solution

One server serves a launch-time list of Projects. `--project /path` is repeatable and, with no `--project`, the server serves the current directory exactly as it does today. The browser is a single origin and a single connection: it shows a Project picker, remembers the last Project, and addresses a Project by `?project=<absolute path>` so a bookmark or homescreen link lands in the right repository. Choosing a Project shows that Project's Sessions, its files, and nothing from any other Project. The idle pool keeps ADR 0007's policy unchanged, so the only thing that changed is how many Projects one pool can serve.

## User Stories

### Starting a server that serves several Projects
1. As the owner, I want to pass `--project /path` more than once, so that one server process serves several Projects.
2. As the owner, I want a server started with no `--project` to serve the current directory, so that the common one-repository case needs no flags.
3. As the owner, I want a path that is not a readable directory to stop the server at startup with an error naming it, so that a typo is never a Project that silently never appears.
4. As the owner, I want duplicate paths rejected after resolving symlinks, so that the same Project cannot appear twice under two spellings.
5. As the owner, I want a Project nested inside another served Project rejected with an error naming both, so that every served path has exactly one root.
6. As the owner, I want `--help` to describe `--project` as repeatable and to no longer offer `--cwd`, so that the flag surface has one name per concept.
7. As the owner, I want the healthy-start output to name every Project being served, so that what the server is serving is visible in the line I paste into a bug report.
8. As the owner, I want no way to add a Project from the browser, so that which files the server will serve is fixed by the command line and nothing else.
9. As the owner, I want the port, host, idle timeout, keep-alive and allowed-origin flags to behave exactly as they do now, so that deployment is unchanged by this feature.

### Choosing and switching a Project
10. As a phone user, I want one URL and one connection for all my Projects, so that I never juggle ports or browser tabs.
11. As a phone user, I want the Project list as the first screen when nothing is remembered, so that I can choose where to work without guessing.
12. As a phone user, I want to choose a Project in one tap and land on its Sessions, so that switching is faster than starting another server.
13. As a phone user, I want the last Project I chose remembered on the device, so that reopening the app resumes where I left off.
14. As a phone user, I want `?project=<absolute path>` to open that Project directly, so that a bookmark or homescreen shortcut lands in the right repository.
15. As a phone user, I want two served Projects whose folder names match to be distinguishable by their parent folders, so that `~/work/api` and `~/oss/api` are not the same row.
16. As a phone user, I want a remembered or linked Project the server no longer serves to show the picker with a notice naming that path, so that I am told why the app opened empty.
17. As a phone user, I want that notice to read as a warning rather than as ordinary body text, so that I notice it without being told a failure occurred.
18. As a phone user, I want a server that serves exactly one Project to skip the picker entirely, so that the single-repository experience stays one tap.
19. As a phone user, I want the Project switcher reachable from the Sessions drawer at any time, so that I can change Projects without reloading.
20. As a phone user, I want choosing a Project to leave any other phone looking at a different Project untouched, so that two devices never fight over what the server is showing.

### Sessions within a Project
21. As a phone user, I want the drawer to list only the chosen Project's Sessions, so that Sessions from different repositories never mix in one list.
22. As a phone user, I want a new Session created in the chosen Project, so that the Pi child runs in the right folder.
23. As a phone user, I want a Project with no Sessions to open to an empty transcript with New Session available, so that a fresh repository is a normal starting point.
24. As a phone user, I want a Session whose Pi child was evicted to show `Starting…` and then its transcript when I open it, so that eviction is invisible beyond a moment's wait.
25. As a phone user, I want a run started in one Project to keep running while I look at another Project, so that switching views never stops work.
26. As a phone user, I want the live Session list to update while I am looking at a Project, so that a Session that starts or settles appears without a reload.
27. As a phone user, I want to fork, clone, rename or export a Session without leaving its Project, so that these actions keep working exactly as they do now.
28. As a phone user, I want to reopen a Session by its Project and its id, so that the server never has to search for which Project a Session belongs to.
29. As a phone user, I want activity for other Projects' Sessions not sent to me, so that the payload I receive on a phone is only about what I am looking at.

### Files
30. As a phone user, I want the file panel to follow the chosen Project rather than the open Session, so that I can browse a repository's files before opening any Session.
31. As a phone user, I want the folder control disabled while no Project is chosen, so that the panel never opens against an undefined root.
32. As a phone user, I want directory listing, preview and download restricted to the chosen Project, so that no request can read another served Project's files.
33. As a phone user, I want a symlink that points outside the chosen Project refused, just as it is today, so that adding Projects does not widen what a Project can reach.
34. As the owner, I want one containment check rooted at the chosen Project, so that the safety rule is stated once rather than once per Project pair.

### Memory and lifecycle
35. As the owner, I want the idle window and eviction rule unchanged, so that this change does not move the numbers ADR 0007 was chosen from.
36. As the owner, I want switching Projects recorded as a new way to seat several Pi children at once, so that a future cap is chosen against a measurement rather than a guess.
37. As the owner, I want Ctrl-C to stop every Pi child across every Project, so that one process means one place to clean up.

### The wire and the codebase
38. As a developer, I want a Session named on the wire by a single value pairing its Project and its id, so that a message can never carry half an identity.
39. As a developer, I want server-to-client messages to echo that pair, so that the client routes every message without consulting its own memory of what it asked for.
40. As a developer, I want only the messages that are about a Project to carry a bare Project — listing Projects, listing Sessions, creating a Session, and file operations — so that no message carries a field it does not need.
41. As a developer, I want a Project represented on the wire as its absolute path, so that there is no id table to keep in sync with the filesystem.
42. As a developer, I want a Session's Project to come from the message that names it rather than be repeated inside the Projection, so that there is one source of truth for which Project a Session belongs to.
43. As a developer, I want a pair naming a Session its Project does not hold to be a protocol error, so that a client bug is reported as one instead of becoming a search across Projects.
44. As a developer, I want the vocabulary renamed once across protocol, config and tests, so that `cwd` does not survive as a second name for Project.

### Documentation
45. As a reader, I want `GLOSSARY.md` to define Project and list `cwd` as a word to avoid, so that new code and prose use one term.
46. As a reader, I want ADR 0008 to record why one process serves many Projects, why a supervisor was rejected, and why a Session is named by a pair rather than an id, so that the obvious alternatives are not re-proposed.
47. As a reader, I want the README's launcher section to describe `--project`, so that the documented way to start the server matches the flag.

## Implementation Decisions

**Command line.** `--project <path>` is repeatable and parsed alongside the existing flags; `--cwd` is removed, not aliased. With no `--project`, the server's Project list is the current directory. Every path is resolved with `realpath` and normalised; a path that is not a readable directory, a duplicate, or a Project nested inside another served Project refuses startup with an error naming the offending path(s). The start banner prints one line per served Project.

**Project identity.** A Project's identity is its absolute path, everywhere: on the wire, in the client's URL and storage, and in the server's registry. There is no opaque project id and no stored display name. The server derives nothing about labels; the client derives a label from the last path segment and disambiguates collisions by adding parent segments until two labels differ.

**Registry.** The server holds an immutable, ordered list of served Projects built at startup from the flags. Nothing mutates it: no runtime addition, removal, or reordering. Order is the order given on the command line, so the list a user sees is the list they typed.

**Protocol.** The protocol gains a Projects request and a Projects response carrying the served paths in registry order. Listing Sessions and creating a Session name a Project; so do the file operations (list, preview, and download). `ListProjects` is answered from the registry and starts no Pi child.

**Session identity.** Every session-scoped message, in both directions, carries one composite value pairing the Project with the Session id, replacing the bare id: the inbound subscribe, prompt, bash, abort, model, thinking-level, auto-compaction, compact, stats, rename, export, fork-messages, fork, clone, tree, move-leaf, reconnect, steer and subagent-transcript messages, and the outbound Snapshot, Delta, Settings, Commands, Stats, SessionCreated, rename, export, fork, tree, leaf, subagent and session-scoped Error messages. One value, not two fields, so that half a key cannot be sent. A pair whose Project is not in the registry, or whose id that Project does not hold, is rejected at the boundary as a protocol error: the server never searches another Project. The pushed Session list stays a push, but becomes per connection: a connection watches one Project's list and one Session, and is pushed only that Project's Sessions, only their activity, and only that Session's Deltas. The Projection stops carrying a working directory altogether: the Project comes from the pair on the message that carries the Projection, so the two cannot disagree.

**Session listing and lookup.** Listing Sessions for a Project uses pi's SessionManager scoped to that Project. Resolving a Session uses the pair: the named Project is looked up in the registry and the id is searched for within it only. The pool's id map is keyed by the pair rather than by the id alone; the absolute Session file path stays canonical and remains what a Session is keyed by once pi has named its file.

**Files.** Every file request carries the Project it is about; the existing containment check receives that Project's root, so lexical rejection of absolute paths and `..`, `realpath` validation, and the escape check all stay as they are. A file request naming a Project outside the registry is refused.

**Client.** The client reads `?project=` in addition to `?session=` and `?ws=`, and stores the chosen Project on the device. On load: a remembered or linked Project that the registry contains selects it; one that the registry does not contain selects nothing and shows the picker with a warning-coloured notice naming the path; nothing remembered shows the picker. A registry of exactly one Project selects it without showing the picker. The drawer becomes two levels — Projects, then the chosen Project's Sessions — with the Project switcher always reachable. The folder control is disabled whenever no Project is chosen. The client asks for a Project's list when it is chosen and re-asks on reconnect, as it asks for the list today.

**Naming sweep.** `cwd` becomes `project` across config, protocol, server and tests in this change, including the help text and the README launcher section. The e2e harness's server-starter takes a Project list; specs that serve one Project pass one entry.

**Explicitly unchanged.** ADR 0007's eviction rule and 120 s window, one pool per server process, per-Session children, the Snapshot/Delta/Cursor model, the Bridge, the transport's reconnect and resync, the origin allowlist, and the health endpoint.

## Testing Decisions

A good test drives the real server, or the client store through its `ServerMessage` input, and asserts on what a user or a browser can observe. It never asserts on registry internals, never hand-builds protocol ceremony, and never reaches into the pool.

**No new seam.** Both layers already exist (ADR 0005) and this feature fits them, which is the signal that the module boundary is right.

**Layer 1 — end to end, real pi, scripted provider, real bridge.** This is where the feature is accepted, because every interesting question is cross-Project and only a real server can answer it: start one server with two seeded Projects, choose each in the browser, and assert that the drawer's Sessions and the file panel change together and never show the other Project's entries. The cases worth their own spec: switching Projects keeps a run alive in the Project left behind; a Session from Project A is still openable after switching to Project B; a pair naming an id that belongs to the other served Project is refused as a protocol error and nothing is searched; a remembered Project absent from the registry produces the picker plus the notice; one Project in the registry skips the picker; a Project with no Sessions opens to an empty transcript; two Projects sharing a last path segment are distinguishable; the folder control is disabled before a Project is chosen.

**Layer 1, launcher cases.** Bad path, duplicate path and nested path each refuse startup and name the path in the error; the start banner names every Project. These run the launcher directly, as the existing flag specs do.

**Layer 2 — store and component tests fed `ServerMessage` objects.** These cover the client's own rules without a server: `?project=` parsing, the remembered-Project and no-Project cases, the picker's label disambiguation, the warning notice, the folder control's disabled state, routing a message to the right session slice from its carried pair alone, and ignoring activity for Sessions outside the watched Project's list. Prior art is the existing store tests that feed typed messages and assert rendered output.

**Path safety.** The existing path-safety cases are extended with the cross-Project escape: a symlink inside Project A that resolves into Project B is refused, because it leaves A's root.

**Not tested by waiting.** Nothing here needs the clock: eviction is exercised through the existing injected-clock eviction specs, not through Project switching.

## Out of Scope

- A supervisor process, a per-Project server fleet, or a second single-project mode; ADR 0008 rejects all three.
- Adding or removing a Project at runtime, including an "open folder" action in the browser.
- Any cross-Project view: recent Sessions across Projects, cross-Project search, a global activity feed, or a combined file tree.
- Per-Project memory caps, a total-children cap, or any change to ADR 0007's policy. Measuring the widened exposure is a follow-up.
- Preserving a Project's Sessions when its directory moves; a moved directory is a different Project by design.
- Authentication, accounts, or per-Project permissions: one user, one allowlist.
- Restoring a backed-up or renamed Session file across Projects.

## Further Notes

- The e2e rename is the bulk of the diff: roughly three dozen specs start a server with one working directory, and they should move in the same change so the vocabulary lands once.
- Before any pool cap is considered, the pool measurement should be re-run with children seated under several Projects, and the result added to `docs/measurements.md` beside the existing figures. No number is projected here.
- `docs/adr/0007` describes the pool in terms of "a Session"; it stays correct, but its ceiling is now reachable by navigation alone, which ADR 0008 records.
- The Caddy and Tailscale deployment story is unaffected: one origin, one port, one allowlist.

## Comments

Implemented and merged as `beeb3e42485412e170d99fb4a8fc4cefbc613e69`. All six tickets are resolved (launcher serves the Project list, a Session is named by Project and id, every Session command names the pair, the browser chooses and switches Project, the file panel follows the chosen Project, and the Project vocabulary is in the docs). The full gate passed on that merge: all 5 steps green, including the sharded end-to-end suite at 169/169 tests across 3 shards.
