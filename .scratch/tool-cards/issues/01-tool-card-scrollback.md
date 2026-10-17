# 01: Give a tool call's card its input, and fold its output

**Status:** resolved

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

Shell tools are one treatment: `bash` and `powershell` share every branch. The tool families are
decided once, in `kindOf()` in `packages/client/src/lib/tools/call.ts`, so a card never repeats a
tool-name comparison.

## Edge cases, and how they are handled

- **pi states its limits at the end of the output.** bash spills to a temp file and appends
  `[Showing lines 18001-20000 of 20000. Full output: /tmp/pi-bash-….log]`; grep, find and ls append
  limit notices; read appends a continuation notice. The tail is parsed off *before* any cap, so the
  notice stays visible while the body is folded. Notices are matched against pi's five notice shapes,
  so a command that legitimately prints `[ok]` keeps its line, and every trailing notice paragraph is
  lifted, not only the last.
- **Command endings are a shell-only shape.** `Command exited with code 3` becomes `Failed · exit 3`,
  and `Command aborted`, `Command timed out after N seconds`, `Command terminated without an exit
  code` likewise. A `read` of a log whose last line happens to say `Command aborted` keeps that line
  as body text and stays `Done`.
- **The spill path** is middle-ellipsized while folded and shown whole once the body opens (or when
  there is no fold to open at all).
- **A single enormous line** (a minified file, a 500-char grep match) is clamped per line, and a
  clamped line is itself a fold: the label says `1 line cut short` and opening shows the whole line.
  A long command or pattern is clipped the same way rather than filling the row.
- **An expanded output** is rendered as one text node, not one element per line: pi caps a shell
  command at 2000 lines, and 2000 re-styled paragraphs is jank for a view the reader asked to see
  whole.
- **A trailing newline** does not count as a line, so a fold's count matches what a reader sees.
- **Nested extension arguments** (MCP objects, arrays) are shown as clipped JSON rather than dropped.
- **A finished call with no output** says `(no output)`; a running call with no arguments yet shows
  `…` rather than a blank prompt line.
- **Diff lines** carry their hue as a row tint with the code in ink: green and red mean "finished"
  and "failed" in this palette, and an added line is neither.

## Not handled

- A call whose result never arrives (the process died mid-run) shows `Running` forever: the
  Projection has no result to fold in. Server-side.
- Image results are dropped by the Projection; a `read` of a PNG shows pi's text note only.
- Structured tool-result `details` are still not carried on the wire; notices and endings are parsed
  from pi's text, so a wording change in pi needs the patterns in
  `packages/client/src/lib/tools/call.ts` updated.
- The output text still crosses the wire whole; capping it server-side would be a protocol change.

## Verification

`packages/client/test/tool-cards.test.ts` covers each case above through the store: notice hoisting
and every notice kept, the spill path folded and whole, shell endings and their non-shell
counterpart, per-line clamping and opening a clamped line, a trailing newline, the one-text-node
expansion, list nouns, nested arguments, a clipped long command, `(no output)` and `…`.

End to end, `packages/e2e/test/tool-cards.spec.ts` folds a scripted 50-line output and opens it in
place; `touch-targets` sweeps the folds as 44 px controls, and `phone-fit` asserts the running pulse
under reduced motion.
