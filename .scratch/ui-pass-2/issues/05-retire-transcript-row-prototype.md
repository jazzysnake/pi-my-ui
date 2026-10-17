# 05: Retire the throwaway transcript-row prototype

**What to build:** The transcript-row prototype has served its purpose as a reference for the
shipped card, copy, code and error treatments. Remove the whole prototype — every variant including
the approved variant A, the fixtures, the switcher, and the dev-only entry point and script that
mount it — so the working branch contains only the shipped implementation. Keep the spec and its
evidence screenshots as the design record.

**Blocked by:** 01, 02, 03, 04 (the prototype is the reference until all its decisions are shipped).

**Status:** resolved

- [x] No prototype variant, fixture, switcher or dev-only prototype entry point remains in the client
      or the root scripts.
- [x] The approved look lives on only in the shipped transcript implementation; the spec and evidence
      screenshots remain.
- [x] The client builds, typechecks, lints and tests without the prototype.
- [x] No production bundle contains prototype code.

## Comments

Resolved on `integration/ui-pass-2` by merge `38123d9` (implementation `810f0ff`). The prototype
directory, root `prototype:rows` script, client `dev` script and dev-only mount branch are gone;
`main.ts` now mounts the app unconditionally. The spec and all evidence screenshots remain. Full
verify is green (154 client tests, 128/128 e2e), and the production bundle audit found no prototype
identifiers.
