# 02: A failed turn leaves a durable error block

**What to build:** A failed assistant attempt becomes an error block in the message's own card, so
the failure is readable in the transcript and survives a reload. Both the seed path and the live path
derive the block from one rule: an assistant message that ended in error contributes an error block
after its content, carrying pi's error text or "the run failed" when pi gave none. An error-only
attempt renders the danger-toned box as the card's only block, with an `error` label and no copy
control. An attempt that produced no content and did not fail leaves no row. The live run-state row
keeps reporting the failure while the run is live.

Reference: the committed transcript-row prototype's error-card treatment is normative for appearance.

**Blocked by:** 01 (the error block is presented inside the message card).

**Status:** ready-for-agent

- [ ] The protocol's content-block union exposes an error block carrying its text, and every
      exhaustive consumer compiles against it.
- [ ] An assistant message whose stop reason is error projects an error block after any content,
      with pi's error text; a missing text falls back to "the run failed".
- [ ] The seed path and the live path produce the same error block for the same failed attempt.
- [ ] An error-only attempt renders as the card's only block: danger-toned, with a meta-caps `error`
      label, wrapped text, and no copy control.
- [ ] A failed attempt with content renders its content first and the error block after it; the
      card's copy control, when present, copies only the content text as today.
- [ ] An empty, cancelled or aborted attempt that produced no content leaves no row on either path.
- [ ] The failure is still shown after a reload or rejoin, while the live run-state row still reports
      the failure during the run.
- [ ] No rework of the run-state row is needed; it keeps its current failure reporting.
- [ ] A client component test feeding a Snapshot with an error block covers its rendering, tone,
      label and lack of copy control.
- [ ] An end-to-end test with a real failed turn shows the error text live and again after reload; a
      seeded empty assistant message produces no row.
