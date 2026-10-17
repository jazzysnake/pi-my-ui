# 01: Give a tool call's card its input, and fold its output

**Status:** implemented

**Prototype (design record):** branch `prototype/tool-cards`, commit `993365d` — three treatments
(a capped card, a one-line fold-out list, a terminal scrollback) over one fixture set covering all
eight built-in pi tools plus two extension tools. Variant C, the scrollback, was chosen.

## Problem

A tool-call card showed the tool's name, its status and its whole output. The call's arguments were
never rendered at all, so a reader could not tell what a command ran, which file was read, or what an
edit changed. And because nothing bounded the output, one `read` of a 400-line file, or one
`write` of a long document, took over the transcript and pushed the following calls off the screen.

## Decision

The card is a scrollback row:

- a prompt line states the input — the command for a shell tool, the path and line window for a read,
  the pattern for a search, and every scalar argument beside it;
- the call's effect follows: a numbered preview for a read, a diff for an edit, the first lines of a
  write's content, the output for everything else;
- a fold at the point the preview stops, which opens that region in place (`⤷ 6 more lines`,
  `⤷ 2 more matches`, `⤷ collapse`).

Shell tools are one treatment: `bash` and `powershell` share every branch.

## Edge cases, and how they are handled

- **pi states its limits at the end of the output.** bash spills to a temp file and appends
  `[Showing lines 18001-20000 of 20000. Full output: /tmp/pi-bash-….log]`; grep, find and ls append
  limit notices; read appends a continuation notice. The tail is parsed off *before* any cap, so the
  notice stays visible while the body is folded. Notices are matched against pi's five notice shapes,
  so a command that legitimately prints `[ok]` keeps its line.
- **The spill path** is middle-ellipsized while folded and shown whole once the body opens (or when
  there is no fold to open at all).
- **Shell endings move into the status:** `Command exited with code 3` → `Failed · exit 3`;
  `Command aborted`, `Command timed out after N seconds` and `Command terminated without an exit
  code` likewise. They no longer hide under the fold.
- **A single enormous line** (a minified file, a 500-char grep match) is clamped per line, so line
  counts alone cannot bound the card.
- **An expanded 2000-line output** is rendered as one text node, not 2000 paragraphs.
- **Nested extension arguments** (MCP objects, arrays) are shown as clipped JSON rather than dropped.
- **A finished call with no output** says `(no output)`; a running call with empty arguments shows
  `…` rather than a blank row.
- **Diff lines** carry their hue as a row tint with the code in ink: green and red mean "finished"
  and "failed" in this palette, and an added line is neither.

## Not handled

- A call whose result never arrives (the process died mid-run) shows `Running` forever: the
  Projection has no result to fold in. Server-side.
- Image results are dropped by the Projection; a `read` of a PNG shows pi's text note only.
- Structured tool-result `details` are still not carried on the wire; notices are parsed from pi's
  text, so a wording change in pi needs the patterns in `packages/client/src/lib/tools/call.ts`
  updated.
- The output text still crosses the wire whole; capping it server-side would be a protocol change.

## Verification

Component tests in `packages/client/test/tool-cards.test.ts` cover each case above through the store.
End-to-end: `tool-cards`, `touch-targets` (the folds are 44 px controls) and `phone-fit` (the running
pulse under reduced motion). A real scripted run of `seq 1 20000` was used to confirm pi's spill
notice survives the fold.
