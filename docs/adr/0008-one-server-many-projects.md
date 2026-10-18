# One server serves many Projects, and a Project is an absolute path

Status: accepted

A phone user with four repositories had to run four servers on four ports, each with its own idle
pool of Pi children, and switch by changing port. One server now serves a launch-time list of
Projects: `--project /path/to/project` is repeatable, and with no `--project` the server serves
exactly the current directory, as before. A Project has no identity beyond its absolute path: one
Project is one absolute path, one Session belongs to exactly one Project, and a Project's Sessions
and files are found by its path. `cwd` is retired as a domain noun and survives only as the string
handed to `spawn`.

The alternatives were a supervisor that spawns a per-project server and a proxy the browser talks to
instead, and a second mode in which the server is single-project unless told otherwise. Both were
rejected as more moving parts for the same user-visible outcome. A supervisor keeps N idle pools,
which is the cost ADR 0007 exists to bound; a second mode makes every policy — eviction, file
serving, Session listing, the protocol — conditional on which mode is running.

The server keeps no active Project. The browser names the Project on the requests that are about a
Project — listing Sessions, creating a Session, listing or previewing a file — and names a Session by
the pair of its Project and its id, sent and echoed in both directions. A composite key was chosen
over an id alone because the alternative is a lookup: pi can only find a Session file within a
directory, so an id without its Project must be resolved by searching every served Project, and that
search can succeed twice. A pair the named Project does not hold is a protocol error, never a reason
to look elsewhere. A connection watches one Project's Session list and one Session, and is pushed
activity only for the Sessions in that list; watching is connection state, so two phones can look at
two Projects without either disturbing the other.

Two rules keep file serving unambiguous: Projects may not nest, and duplicates are rejected after
`realpath`. Each served path therefore has exactly one root, and the containment check in
`packages/server/src/files/path-safety.ts` needs no second, narrower root to consider. A path in the
list that is not a readable directory is a startup error naming it, not a Project that goes quietly
missing on a phone where stderr is invisible.

There is no way to add a Project at runtime. The launch flag is the whole allowlist because that is
what bounds which files the server will serve; an "open folder" action from the browser would reopen
that boundary and needs its own trust design.

Consequences:

- The idle pool keeps ADR 0007's policy unchanged — one 120 s window, no count cap. Switching
  Projects now seats children across Projects, so the measured 1.47 GB at eight Sessions is
  reachable by navigation alone. No cap is added here: the exposure is recorded so a cap, if it
  comes, is chosen against its own measurement rather than in the same change that widened it.
- A Project whose directory moved is a different Project. Its Sessions live under the old path and
  are not found; there is deliberately no id indirection that would preserve them.
- The browser addresses a Project by `?project=<absolute path>`, remembers the last one, and shows
  the picker when nothing is remembered. A remembered or linked Project the server does not serve is
  not an error state: the picker is shown with a notice naming the path, carried in the warning
  colour rather than as dim body text. `packages/client/src/app.css` fixes the accent meanings —
  green sent, amber waiting or warning, red failure — and nothing has failed here, so red would
  misreport the cause. With exactly one Project allowed, the picker is skipped and the single-Project
  server keeps today's one-tap start.
- A Project with no Sessions is a normal state, as is two allowed Projects whose last path segment
  matches; the second is disambiguated by parent segments rather than by a stored display name.
- Session ids stay `randomUUID()`, but the pool's id map becomes a map keyed by the pair; the
  absolute Session file path stays canonical, and remains what a Session is keyed by once its file
  exists.
- The roughly three dozen e2e specs that start a server for one Project pass a one-entry Project
  list in the same change, so the vocabulary lands once rather than in a later cleanup pass.
