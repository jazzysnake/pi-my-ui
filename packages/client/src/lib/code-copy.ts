/**
 * Fenced code gets its own copy control by upgrading the sanitized markdown after it renders.
 *
 * The control cannot ship inside the HTML: `renderMarkdown` is the client's only sanitized sink, so
 * anything added to the markup would bypass it. The strip is the scrolling `pre`'s sibling rather
 * than an overlay, because wide code scrolls sideways inside its own box and a pinned control would
 * end up on top of it.
 */

import { mount, unmount } from "svelte";

import CopyButton from "./CopyButton.svelte";

/**
 * The clipboard text for one block: its code, with the fence and language label already gone. The
 * control reads it at tap time, so the text is never copied out of the markup into a second source.
 */
function codeText(pre: HTMLPreElement): string {
  const code = pre.querySelector("code") ?? pre;
  // `marked` ends a fenced block with the newline that preceded its closing fence; that newline is
  // markup, not the command a reader means to paste.
  return (code.textContent ?? "").replace(/\n$/, "");
}

/** Attach a copy control to every `pre` under `root`; returns the teardown for the mounted controls. */
export function upgradeCodeBlocks(root: HTMLElement): () => void {
  const teardowns: (() => void)[] = [];

  for (const pre of root.querySelectorAll<HTMLPreElement>("pre")) {
    if (pre.parentElement?.classList.contains("code-copy-frame")) {
      continue;
    }

    const frame = document.createElement("div");
    frame.className = "code-copy-frame";
    frame.dataset["testid"] = "code-block";
    const strip = document.createElement("div");
    strip.className = "code-copy-strip";
    strip.dataset["testid"] = "code-copy-strip";

    pre.replaceWith(frame);
    frame.append(strip, pre);

    const control = mount(CopyButton, {
      target: strip,
      props: {
        text: () => codeText(pre),
        label: "Copy code",
        class: "size-11",
        testId: "copy-code",
      },
    });
    teardowns.push(() => {
      unmount(control);
    });
  }

  return () => {
    for (const teardown of teardowns) {
      teardown();
    }
  };
}
