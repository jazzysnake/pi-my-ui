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

**Status:** open

- [ ] `node_modules` at any depth is not walked, with or without a `.gitignore`
- [ ] A root `.gitignore` excluding `vendor/` hides a `.git`-marked directory inside it
- [ ] A nested `.gitignore` applies to its own subtree and not to its siblings
- [ ] Ancestor rules still apply one level down
- [ ] `!keep/` re-includes a directory an earlier line excluded, and the walk enters it
- [ ] An unreadable `.gitignore` does not fail the walk
- [ ] `.venv` and `.venvs` remain pruned as dot-directories, asserted so the behaviour is named
- [ ] The walk still runs no git command, and still never follows a symlinked directory
- [ ] The guide, the spec and ADR 0012 agree with the code
