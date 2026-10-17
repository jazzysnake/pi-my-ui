# 37: The connect dot and the Files icon are in each other's place

**Category:** bug

**Blocked by:** None (can start immediately)

**Status:** resolved

**Symptom:** In the header's right-hand group the order is reversed from the previous UI: the folder
comes first and the connection dot sits on the trailing edge. Owner: "the connect dot and the file
icon locations are swapped."

**Repro:** open the app and look at the header's right-hand end. Compare with the previous UI.

**Evidence:** `acceptance-1/crop-v2-header.png` (folder, then dot) against
`acceptance-1/crop-v1-header.png` (dot, then folder), both at 4x.

**Desired:** dot, then Files — Files rightmost, as in the previous UI.

**Previous UI, for comparison (v1, `../pi-my-ui`, read-only reference):** the header's end slot in
`packages/client/src/components/AppShell.svelte` records the order as deliberate — the dot first, then
Files, because Files is the control that has to respect the right safe area and the header's own
trailing padding is what keeps it clear of it.

Also observed in the same row, not reported by the owner: the wordmark is bold and bright here
(`text-body font-semibold`) where the previous UI's is dim and tracked (`text-label tracking-wider
text-dim`), making it the loudest item in a row of controls. Fold it in only if it falls out of the
ordering change; otherwise leave it.

**Done when**

- [x] The header's end group reads connection status, then Files, and Files is the rightmost control
- [x] Both controls keep their current size, position within the safe area, and test ids
- [x] `npm run verify` green

## Comments

Resolved on `v2-rewrite`. The end group in `packages/client/src/lib/TopBar.svelte` now reads agent
pill, connection status, Files: the two elements swapped places and nothing else moved. Both controls
keep `size-11` and `shrink-0` inside the `ml-auto` group and keep their test ids (`connection-status`
and `files-toggle`), and the header's own `px-2` is what keeps Files clear of the right safe area.
The wordmark was left alone — its weight and colour do not fall out of the ordering change, and the
ticket made folding it in conditional on that.

Coverage, written red first against the swapped order:

- `packages/client/test/header.test.ts` mounts the shell and asserts the connection status precedes
the Files toggle and that Files is the header's last control (the component seam).
- `packages/e2e/test/phone-layout.spec.ts`'s top-bar test now measures the rendered boxes at 320 px:
the dot's right edge ends before Files begins and Files' right edge is the rightmost in the bar (the
rendered seam ticket 36 added).

`docs/guide.md`'s region-by-region list stated the old order, so it now names the dot before Files.

`npm run verify` is green: typecheck, lint/format, 134 store and component tests, build, and 113
end-to-end tests across 2 shards in ~47 s.

One later change to the same row: ticket 41 moved the agent pill out of the header and into the
session bar, so the end group now begins at the connection dot; the order this ticket records is
unchanged.
