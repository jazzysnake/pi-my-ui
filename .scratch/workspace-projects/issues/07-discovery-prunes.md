# 07: Discovery skips what is not worth walking

**What to build:** The walk stops descending into directories that would only cost time and produce
noise: `node_modules` by name, and anything an in-repo `.gitignore` excludes. The measured reason is
in the ADR: a real workspace of 36 Projects took 3.3 s per `ListProjects`, almost all of it inside
installed package trees.

- `node_modules` is pruned by name at any depth, whether or not a `.gitignore` mentions it.
- `.gitignore` files are honoured the way git honours them for a walk: the file in a directory applies
  to that directory and everything below it, rules from ancestors still apply in a subdirectory, and
  an ignored directory is pruned rather than descended into. Negation works on the directory itself —
  a later `!keep/` line re-includes it and the walk enters.
- Dot-directories stay pruned, which is what already covers `.venv`, `.venvs`, `.git` and
  `.worktrees`.
- Not honoured, deliberately: `.git/info/exclude`, a global `core.excludesFile`, and any `.gitignore`
  outside the workspace. The server still runs no git command.
- An unreadable or unparseable `.gitignore` is ignored rather than fatal, like an unreadable
  directory.

**Files:** the server's discovery module and its package manifest (the `ignore` package, pinned like
every other dependency), the backend workspace spec, the guide sentence that describes what the walk
skips, the spec's Discovery decision, and ADR 0012's consequence that recorded the opposite.

**Blocked by:** None.

**Status:** resolved

- [x] `node_modules` at any depth is not walked, with or without a `.gitignore`
- [x] A root `.gitignore` excluding `vendor/` hides a `.git`-marked directory inside it
- [x] A nested `.gitignore` applies to its own subtree and not to its siblings
- [x] Ancestor rules still apply one level down
- [x] `!keep/` re-includes a directory an earlier line excluded, and the walk enters it
- [x] An unreadable `.gitignore` does not fail the walk
- [x] `.venv` and `.venvs` remain pruned as dot-directories, asserted so the behaviour is named
- [x] The walk still runs no git command, and still never follows a symlinked directory
- [x] The guide, the spec and ADR 0012 agree with the code

## Comments

Merged from `ticket/07-discovery-prunes`: the prunes are `node_modules` by name and `ignore`-based
`.gitignore` rules carried down the walk one directory at a time, so a nested file's patterns stay
relative to the file that holds them and the deepest file decides. Six new backend cases plus `.venv`
asserted by name. Measured on `/home/matee/Workspace/Personal` with the built code: 37 Projects in
1.7–2.1 s, against 37 in 2.9–3.0 s for the same walk before the prunes, and the 36 Projects / 3.3 s
baseline in ADR 0012. What is left is `exploration/`-style trees no `.gitignore` excludes; the
installed trees (`node_modules`, and a 3166-directory untracked `venv/`) are gone from the walk.
