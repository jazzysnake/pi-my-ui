<script lang="ts">
  import { renderMarkdown } from "./markdown.js";

  let { text }: { text: string } = $props();

  const html = $derived(renderMarkdown(text));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown returns DOMPurify's output, and this is the client's only HTML sink. -->
<div class="md min-w-0 max-w-full" data-testid="markdown">{@html html}</div>

<style>
  .md {
    overflow-wrap: anywhere;
  }
  /* The injected markup carries no Svelte scope class, so the descendant selectors are global. */
  .md :global(h1) {
    margin: 0.75rem 0 0.4rem;
    font-size: 1.25rem;
    font-weight: 600;
  }
  .md :global(h2) {
    margin: 0.7rem 0 0.4rem;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .md :global(h3),
  .md :global(h4) {
    margin: 0.6rem 0 0.3rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .md :global(p) {
    margin: 0.5rem 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0.5rem 0;
    padding-left: 1.25rem;
  }
  .md :global(ul) {
    list-style: disc;
  }
  .md :global(ol) {
    list-style: decimal;
  }
  .md :global(blockquote) {
    margin: 0.5rem 0;
    border-left: 3px solid #404040;
    padding-left: 0.75rem;
    color: #a3a3a3;
  }
  .md :global(a) {
    color: #60a5fa;
    text-decoration: underline;
  }
  /* A wide code block scrolls inside itself; the transcript and the page never widen for it. */
  .md :global(pre) {
    max-width: 100%;
    overflow-x: auto;
    margin: 0.5rem 0;
    border: 1px solid #262626;
    border-radius: 0.25rem;
    background: #171717;
    padding: 0.5rem;
    font-size: 0.75rem;
  }
  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .md :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: 0.75rem;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid #404040;
    padding: 0.25rem 0.5rem;
    text-align: left;
  }
</style>
