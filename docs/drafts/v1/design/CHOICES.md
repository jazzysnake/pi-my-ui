# CHOICES — review sheet for the design variants (D-T1 → D-T2)

Fill this in while looking at the variants. For each surface, write which variant's **approach** you prefer
(`A`, `B`, `C`, or `mix` with a note) and anything you want changed. This is the input to D-T2, where the
choices become an ADR.

Nothing here is a commitment to a finished look — pick the elements you like; a `mix` is expected.

Legend: **A** = Console (dense monospace) · **B** = Journal (card timeline) · **C** = Focus (minimal, sheets)

| # | Surface | What to compare | Your pick (A / B / C / mix) | Notes |
|---|---------|-----------------|-----------------------------|-------|
| 1 | Session sidebar | collapsed-by-default behaviour; row density; where the live activity dot goes; how it opens (drawer width, scrim, full-screen) | | |
| 2 | Transcript | message separation (hairline rows vs cards vs plain type); how streamed vs settled text reads; reasoning collapsed form | | |
| 3 | Tool card | collapsed summary line; expanded args/output; how the diff is drawn (unified here); status treatment | | |
| 4 | Composer | input size and auto-grow feel; send vs stop while running; branch control at bottom-right; model / thinking / context indicator placement | | |
| 5 | Agent pill | both states (`main`, `name +2`); where the pill sits; how the agent list opens and reads | | |
| 6 | `/tree` modal | search on top, tree below; how collapsed alternative branches look and read; how the current leaf is marked | | |
| 7 | `/` command palette | how commands are listed and filtered; sheet vs inline; templates alongside commands | | |
| 8 | Bash cards (`!` / `!!`) | how visually distinct they are from a tool card; how the context marker reads; the `!` vs `!!` contrast | | |
| 9 | Run states | errored / aborted / compacting; in-progress compaction vs a past compacted boundary; retry attempt display | | |

## Cross-cutting

| Question | Your answer |
|----------|-------------|
| Overall information density: too dense / about right / too sparse? Which variant is closest? | |
| Overall navigation: where should the sidebar/tree/palette/agents live (header, dock, sheets)? | |
| Typography: monospace-led (A) or sans-led (B/C)? Any preference for larger text? | |
| Accent colour direction (green / indigo / lime), or none of these? | |
| Anything that felt confusing or missing in all three? | |

## Surfaces not settled by ADR 0012 / the E3 tickets

If any variant seems to need a surface or behaviour that the ADRs and E3 tickets do **not** describe, write
it here as a question rather than assuming it is in scope (it may need its own ticket or ADR):

- **Light / auto theme.** ADR 0012 scopes the product to a single dark theme, so all three variants are
  dark. If you want a light or system-following theme, that is a new direction none of these draw — it
  would need its own call (D-T2 and possibly a new ADR). Your answer:
- **Anything else** a variant seems to need that no ADR / E3 ticket describes. Your answer:
