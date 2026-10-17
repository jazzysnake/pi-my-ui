# 37: The connect dot and the Files icon are in each other's place

**Category:** bug

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

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

- [ ] The header's end group reads connection status, then Files, and Files is the rightmost control
- [ ] Both controls keep their current size, position within the safe area, and test ids
- [ ] `npm run verify` green
