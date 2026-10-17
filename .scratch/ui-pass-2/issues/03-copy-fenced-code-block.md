# 03: Copy a fenced code block on its own

**What to build:** In rendered assistant markdown, every fenced code block gets its own copy control.
The control copies the code text only, without the fences or a language label, and confirms with the
same check behaviour as the message control. It sits in a short strip at the block's top-right with a
44 px tap box that overflows into the block's own padding, so it never sits on top of horizontally
scrolled code. The control is added by a client-side upgrade of the already-sanitized rendered
markdown and reads the code from the DOM when tapped, so sanitized output remains the only HTML
source. The message-level copy still copies the whole message.

Reference: the committed transcript-row prototype's code-block treatment is normative for appearance.

**Blocked by:** 01 (shares the copy confirmation and tap-target behaviour).

**Status:** resolved

- [x] Every fenced code block in assistant markdown gets a copy control named "Copy code".
- [x] Tapping it writes exactly the code text, with no fences and no language label.
- [x] The control shows the same 1.4 s check confirmation and leaves the glyph unchanged on a
      rejected write.
- [x] The control occupies a 28 px strip at the block's top-right, with a 44 px tap box, and does not
      overlay the code.
- [x] Wide code still scrolls horizontally inside its block; the control stays put.
- [x] The message card's copy control still copies the whole message, including the code.
- [x] The sanitized rendered output remains the only injected HTML; the control is attached after
      sanitization.
- [x] Layout holds at 320 px.
- [x] Component tests cover control presence, copying code only, and confirmation; an end-to-end test
      covers the clipboard contents and the touch target.

## Comments

Resolved on `integration/ui-pass-2` by merge `3e19219`; the code-review follow-up is `f460a60`.
`code-copy.ts` upgrades the sanitized markdown after render, wrapping each `pre` in a frame with a
28 px strip and mounting the shared `CopyButton`; the code text is read from the DOM at tap time with
the fence's trailing newline removed. `markdown.spec.ts` covers exact clipboard contents,
strip/tap-box geometry, no overlay, horizontal scrolling, whole-message copy and 320 px;
`code-copy.test.ts` covers presence, confirmation, rejection and streaming re-render.
