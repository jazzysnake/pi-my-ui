# 06: The review pass

**What to build:** The fixes raised by a two-axis code review (Standards + Spec) of the merged
feature. No new behaviour beyond what the spec and ADR already ask for.

Standards axis: glossary violations ("workspace root", "git root", "folder" in place of Project), two
comments that restate their code, `canCreate` declared but unused with the predicate duplicated at
four call sites, two props named `onCreate` meaning different things, and the names `derived()` and
`book`.

Spec axis: story 24 was unimplemented for a Project that leaves while it is the *chosen* one; the
walk rejected the entire Projects answer when one directory inside the workspace was unreadable, which
left the client with no answer and no picker; `InvalidProjectName` was answered for an existing file
or symlink while its client sentence only mentioned slashes and dots; a `--project` on a temporarily
absent volume was dropped from the registry for the life of the process; the drawer's level effect
fired on any Project change rather than on this client's own create; the spec and ADR claimed the
pre-existing specs were untouched and that only a regular file was refused; and the name sheet grew a
focus-on-open effect without the browser spec the spec's own admission rule owes for it.

**Blocked by:** the five feature tickets, all resolved.

**Status:** resolved

- [x] One unreadable directory is skipped, not fatal, and a backend spec proves the walk still answers
- [x] `--project` is never removed from the registry by a list
- [x] A chosen Project absent from the served list clears the choice and warns, with a store test
- [x] The `InvalidProjectName` sentence covers a name already taken by a file or link
- [x] The drawer returns to Sessions only for a Project this client created
- [x] `canCreate` is the one predicate; `onCreate` no longer means two things
- [x] Vocabulary conforms to `GLOSSARY.md`, including the ADR
- [x] The spec and ADR state the spec-file edits and the symlink refusal truthfully
- [x] One browser spec covers the phone create journey: focus, refusal with text kept, create, empty
      Session list, a Session started in it

## Comments

Merged from `ticket/06-review-fixes`: the fast gate green (236 client, 66 backend), browser suite 86
specs at 31.3 s of the 45 s budget.
