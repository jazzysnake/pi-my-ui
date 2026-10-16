# Design variants (D-T1) — exploratory mockups

**These are exploratory mockups, not shipped code.** They are plain, self-contained HTML files with inline
CSS that exist only to let the product's one user react to layout and density. They are never built, never
bundled, never imported by the app, and carry no maintenance obligation once the `chat-ui` epic begins.

## Why they exist

ADR 0012 describes the mobile layout in prose (collapsed sidebar, transcript, composer with a branch
control, agent pill, tree modal). A prose description cannot be evaluated the way a rendered screen can.
This folder converts an interview into something visible: three genuinely different directions so the user
can pick elements they like from each, rather than selecting one finished design.

## What is here

| File | What it is |
|------|------------|
| `index.html` | Entry point. Lists and links every variant with its name and one-line thesis. |
| `variant-a-console.html` | Variant A — “Console”: dense monospace stream; the transcript is the interface. |
| `variant-b-journal.html` | Variant B — “Journal”: card-on-a-rail timeline; spacious and readable. |
| `variant-c-focus.html` | Variant C — “Focus”: minimal chrome, plain type, secondary surfaces as sheets. |
| `CHOICES.md` | The per-surface review sheet offered to the user for D-T2. It was **left blank** — the answers are in [`USER-FEEDBACK.md`](USER-FEEDBACK.md) — and is kept as the (unfilled) template. |

Each variant is a single file with inline CSS. There is **no CDN, no external font, no network request and
no build step**; every file opens directly from disk. Each covers, in labelled phone-width frames, the
surfaces fixed by ADR 0012 and the E3 tickets: the transcript (streamed message, collapsible tool card with
a diff, collapsed reasoning), the composer (auto-grow input, send/stop, branch control bottom-right, model
/ thinking / context indicators), the collapsed sidebar with a live activity dot, the agent pill in both
states plus the opened agent list, the `/tree` modal, the `/` command palette, a `!` and a `!!` bash card,
and the errored / aborted / compacting run states.

## Where these are referenced

- Epic D — [`../project/design-exploration/epic.md`](../project/design-exploration/epic.md)
- Ticket D-T1 — [`../project/design-exploration/design-variants/ticket.md`](../project/design-exploration/design-variants/ticket.md)
- ADR 0012 — [mobile UI layout](../adr/0012-mobile-ui-layout.md) (layout and behaviour)
- **ADR 0017 — [UI design direction](../adr/0017-ui-design-direction.md) — the chosen look and feel**
- The chosen direction is recorded in [ADR 0017](../adr/0017-ui-design-direction.md) and referenced by the
  `chat-ui` (E3) tickets.

## How to view

Either open a file directly in a browser:

```
# e.g. on the machine that holds the repo
xdg-open docs/design/index.html      # or: open, or drag the file into a browser
```

…or serve the folder over localhost (the ticket's documented option):

```
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs/design
# then browse to http://127.0.0.1:8000/
```

Both work fully offline. On a phone over the same network you can reach the served address from the laptop;
nothing here is exposed beyond localhost by default.

## Scope limits (from ADR 0000 / ADR 0012)

- Phone viewport only (roughly 390 × 844). No desktop layout is designed.
- A single dark theme is the current scope, so all three variants are dark; they differ in hierarchy,
  density and navigation, not merely colour.
- No accounts, no auth, no offline/PWA, no file editing — none of those are drawn.
- These mockups add no dependency and do not touch `packages/**`.

## Reviewing

The variants were offered to the user with a per-surface sheet, [`CHOICES.md`](CHOICES.md). The user did
**not** fill it in — it remains blank — and answered in conversation instead; the outcome is in
[Outcome](#outcome-d-t2-2026-10-11) below and the answers are recorded in
[`USER-FEEDBACK.md`](USER-FEEDBACK.md). If a variant seems to need a surface that is not in ADR 0012 or the
E3 tickets, note it as a question rather than treating it as a decision — D-T2 is where choices become an
ADR.

## Outcome (D-T2, 2026-10-11)

The user reviewed the variants. The verbatim feedback is in [`USER-FEEDBACK.md`](USER-FEEDBACK.md) and the
decision is recorded in [ADR 0017](../adr/0017-ui-design-direction.md): **Variant A “Console” is the base**
(its blue/cyan palette, density and monospace-led type), with **Variant C's composer-control geometry**
(`44×44` round send/stop and `44×44` square branch button, branch rightmost) **restyled into A**. **Variant B
is rejected — borrow nothing.** The per-surface sheet [`CHOICES.md`](CHOICES.md) was **offered to** the user
but **left blank**; the user answered in conversation, and [`USER-FEEDBACK.md`](USER-FEEDBACK.md) is the
authoritative input the decision was recorded from.
