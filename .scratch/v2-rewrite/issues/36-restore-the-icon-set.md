# 36: Most icons are missing, and the ones left are off-style

**Symptom:** Most controls that carried an icon now show no icon at all, and the few that remain do
not match the previous UI's style. Owner: "A large number of icons do not show up (like most) on the
ui … also the whole ui just looks a bit worse, for example notice the icons that we do have are
squished and not in the same style as the previous."

- Message tree: every row is a bare kind label with no leading glyph, and a user row has no fork
  control (v1's had both).
- Composer: the action buttons are the words `Attach`, `Branch`, `Stop` and `Send`; `Send` is clipped
  by its round button.

**Repro:** open a Session, open the message tree, look at the rows; then look at the composer's action
row. Compare with the previous UI on the same Session.

**Evidence:** `acceptance-1/v2-tree.png` and `acceptance-1/v2-composer.png` (now), against
`acceptance-1/v1-tree.png` and `acceptance-1/v1-composer.png` (previous UI, same Session).

**Current state:** the client has no shared icon module; the only SVGs in it are two hand-written
paths in `packages/client/src/lib/TopBar.svelte` and one in `Transcript.svelte`. Everything else that
the previous UI drew as an icon is a text label or absent.

**Desired:** the client's icons come from the same pack and render in the same size and stroke as the
previous UI, and no control draws a word where the previous UI drew an icon. Owner's direction:
"previous project was using lucide icons".

**Previous UI, for comparison (v1, `../pi-my-ui`, read-only reference):**
`packages/client/src/components/Icon.svelte` is the one renderer (`viewBox="0 0 24 24"`,
`stroke="currentColor"`, `stroke-width="2"`, round caps, `aria-hidden`, box defaulting to
`--text-control-glyph` = 20 px); `packages/client/src/lib/icons/paths.ts` holds the pack's geometry as
data, with the licence header; `packages/client/src/lib/message-tree/selection.ts`'s `entryGlyph` maps a
row's kind to its glyph. Icons in use there: composer `paperclip` / `git-branch` / `arrow-up` /
`square`, tree `git-fork` plus the per-kind glyph, pill `diamond`, header `menu` / `folder`, close
`x`.

**Status:** resolved

**Done when**

- [x] Tree rows lead with the glyph for their kind, and a user row carries the fork control
- [x] The composer shows icons for attach, branch, send and stop, none of them clipped or showing text
- [x] The agent pill and the header's two controls still show their icons
- [x] Side by side with the previous UI at 393 px and 320 px, the chosen glyphs, stroke weight and
      optical size match and nothing reads as squished
- [x] `npm run verify` green

## Comments

Resolved on `v2-rewrite`. The client now has one icon module — `lib/icons/paths.ts` holds the pack's
geometry as data with its ISC/MIT header, `lib/icons/index.ts` is the barrel, and `lib/Icon.svelte`
is the only renderer (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width="2"`, round
caps, `aria-hidden`, box defaulting to the new `--text-control-glyph` token at 20 px). Every
hand-written `<svg>` and every text glyph is gone: the header's two controls and the two transcript
buttons draw `menu`/`folder`/`copy`, the composer draws `paperclip`/`git-branch`/`square`/`arrow-up`,
the while-running send is an `arrow-up`, the pill leads with `diamond`, and the tree rows lead with
their kind's glyph (16 px, `size-4`) plus `chevron`/`x`/`git-fork` on a user row. The row's fork
control calls the same `onFork(entryId)` the `/fork` picker uses, so forking from the tree needs no
second path. `entryGlyph` lives beside the row model in `lib/tree/rows.ts`, next to `entryKindLabel`.

`npm run verify` is green: typecheck, lint/format, 132 store and component tests, build, and 113
end-to-end tests across 2 shards in ~46 s. New coverage: `test/icon-set.test.ts` asserts which glyph
each control draws, that none of them renders a word, and that every glyph shares the pack's grid,
stroke and sizing; the e2e specs measure the rendered boxes (20 px in the composer, 16 px in the
tree) so a squished glyph fails the gate.

Review follow-up. The gate's own rules reshaped the first cut rather than its behaviour:

- **Comments** — the history narration is gone. `rows.ts`'s kind comment, the `paths.ts` header, the
  test docblock and the e2e comment now state the constraint (or nothing) instead of what the
  previous UI did.
- **Hygiene** — the eighteen per-icon doc lines in `paths.ts` restated their keys and were dropped.
  The 40 % warning that remains is the ISC/MIT notice the licence requires, not prose.
- **Colour** — Attach, Branch, Stop and the attachment's remove control are back to the inherited ink.
  `app.css` reserves red for a failure and blue for links and commands, and a deliberate abort is
  neither; only the send side keeps the green the palette defines for a send.
- **One kind table** — `entryGlyph` and `entryKindLabel` were two parallel role cascades; they now
  read one `ROW_PRESENTATION` keyed by a single `RowKind`, so a new kind cannot land in one and not
  the other. `icons/index.ts` exports only `ICONS`, `IconGeometry` and `IconName`, and the size token
  is `--control-glyph-size`, out of Tailwind's `--text-*` font-size namespace.
- **Compaction boundary** — the transcript's boundary row now draws `arrow-down-to-line` (16 px),
  which was the one control the previous UI drew as a glyph and this one still did not.
- **Evidence** — `phone-layout.spec.ts` now asserts the glyph boxes (20 px control, 16 px marker),
  the pack's `viewBox` and `stroke-width="2"` at 320, 360, 393 and 430 px; the tree spec asserts the
  per-kind glyph of four named rows instead of only "more than one icon"; the composer spec asserts
  each action is contained inside its 44 px target with no text. `expectComposerSend` in
  `packages/e2e/src/composer-send.ts` is the one assertion for the send/stop pair, replacing eight
  copies.

Known limit, pinned by a test rather than papered over: a compaction or branch-summary *message*
arrives role-less with `entryType: "message"` (`packages/server/src/session-tree.ts`), so the tree
cannot tell it from any other unprojected role and draws `dot`. The previous UI could draw `layers`
there only because its `MessageRole` carried those roles; giving this one the same glyphs needs the
protocol's role union to grow, which is a wire change outside this ticket.
