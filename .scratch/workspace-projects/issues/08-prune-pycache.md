# 08: `__pycache__` joins the prune list

**What to build:** `__pycache__` is pruned by name at any depth, beside `node_modules`. Measured on a
real workspace: 2,602 of the 13,343 directories the walk visited were `__pycache__`, and nothing in
the tree excluded them — one repo's `.gitignore` is three lines long.

Extends ticket 07's mechanism with one more name. The name list stays a deliberate, justified one:
`node_modules` (installed packages) and `__pycache__` (Python bytecode), not a general sweep of
language caches.

**Files:** the server's discovery module, the backend workspace spec, the guide, the spec's Discovery
and Testing Decisions, and ADR 0012's two bullets that name the prunes.

**Blocked by:** None.

**Status:** resolved

- [x] `__pycache__` is not walked at any depth, with no `.gitignore` anywhere
- [x] `node_modules` pruning is unchanged, and the two names read as one rule
- [x] The guide, the spec and ADR 0012 name both

## Comments

Fast gate green (74 backend), `verify:full` green with 86 browser specs in 25.4 s of the 45 s budget.
