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

**Status:** ready-for-agent

- [ ] Every fenced code block in assistant markdown gets a copy control named "Copy code".
- [ ] Tapping it writes exactly the code text, with no fences and no language label.
- [ ] The control shows the same 1.4 s check confirmation and leaves the glyph unchanged on a
      rejected write.
- [ ] The control occupies a 28 px strip at the block's top-right, with a 44 px tap box, and does not
      overlay the code.
- [ ] Wide code still scrolls horizontally inside its block; the control stays put.
- [ ] The message card's copy control still copies the whole message, including the code.
- [ ] The sanitized rendered output remains the only injected HTML; the control is attached after
      sanitization.
- [ ] Layout holds at 320 px.
- [ ] Component tests cover control presence, copying code only, and confirmation; an end-to-end test
      covers the clipboard contents and the touch target.
