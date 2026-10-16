# User design feedback — input to D-T2

Recorded 2026-10-11. This is the raw input for `D-T2 design-decisions`, which turns it into ADR 0017.

## Verbatim

> I llike console the most, but the branch button for tree looks weird there. I like versions C's laoyut
> for those things a bit more

## Interpretation (confirm in D-T2)

- **Overall direction: Variant A — Console** (`docs/design/variant-a-console.html`): dense, monospace-led,
  transcript-as-interface.
- **Composer control row: take Variant C's treatment**
  (`docs/design/variant-c-focus.html:118-119`, `:294-295`) of the branch/tree control — a `44×44` icon
  button (`border-radius:14px`, grid-centred `⑂`) sized to match the send/stop control beside it, as the
  **rightmost** control of the composer row.
- Why A's version reads as "weird": in A the branch control is a text-height chip
  (`variant-a-console.html:136` — `padding:6px 8px; border-radius:6px`) next to a text `send` / `■ stop`
  button, so it looks like a stray tag rather than a tap target. C's is a first-class control.

## Resolved decisions (user, 2026-10-11)

Verbatim follow-up:

> take C's but make it fit the style of the console. 2. A. D yes. B no, journal was not my cup of tea

| # | Question | Decision |
|---|----------|----------|
| 1 | Control pair | **Take C's pair, restyled to Console.** The `44×44` round send/stop button **and** the `44×44` square branch button (C's geometry: `50%` radius for send, `14px` for branch), rendered in **A's visual language** — A's palette, borders, and monospace type, not C's lime/card styling. Branch stays the **rightmost** control of the composer row. Geometry and touch-target size from C; look and feel from A. |
| 2 | Accent colour | **A's palette** (blue/cyan-led). Not C's lime. |
| 3 | Density and typography | **Keep A's dense monospace-led type as-is.** |
| 4 | Anything from B | **Nothing.** Verbatim: "journal was not my cup of tea." Variant B is **rejected** as a source; borrow nothing from it. |

**No open questions remain.** If the decisions leave a sub-choice genuinely unspecified, D-T2 states it as
an open item rather than deciding it.

## Reference files

| Variant | File | User's stance |
|---|---|---|
| A — Console | `variant-a-console.html` | **preferred overall** — base direction, palette, density, typography |
| B — Journal | `variant-b-journal.html` | **rejected** — "not my cup of tea"; borrow nothing |
| C — Focus | `variant-c-focus.html` | **source of the composer control geometry** (`44×44` send/stop + `44×44` branch, branch rightmost), restyled into A |

## What D-T2 must do with this

Record the chosen direction and the per-surface dispositions — **A as the base, C's composer-control
geometry restyled into A, B rejected** — in `docs/adr/0017-ui-design-direction.md`, preserving the verbatim
wording above; point ADR 0012 and the E3 tickets at it; and state any genuinely open item explicitly
rather than deciding it.
