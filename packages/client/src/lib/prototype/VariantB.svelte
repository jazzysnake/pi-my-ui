<script lang="ts">
  /**
   * PROTOTYPE variant B — no card: a two-pixel rail on the left is the whole boundary, coloured by
   * role, with the message's copy control floating in a reserved right gutter so it never lines up
   * with a block's own control. Closest to the shipped "hairlines, not cards" density.
   */
  import ToolCallCard from "../ToolCallCard.svelte";

  import CodeBlock from "./CodeBlock.svelte";
  import CopyButton from "./CopyButton.svelte";
  import DataTable from "./DataTable.svelte";
  import {
    CODE_SHORT,
    CODE_SNIPPET,
    CONNECTION_ERROR,
    DONE_CALL,
    FAILED_CALL,
    NETWORK_ERROR,
    NOTIFICATION_PAYLOAD,
    PARAGRAPH,
    RUNNING_CALL,
    TABLE,
    TAIL,
    THINKING_TEXT,
    USER_TEXT,
  } from "./fixtures.js";
  import ThinkingRow from "./ThinkingRow.svelte";

  let { errorShape }: { errorShape: "card" | "strip" } = $props();
</script>

{#snippet notification(text: string, open = false)}
  <details class="border-y border-hairline py-1" {open}>
    <summary class="flex min-h-9 cursor-pointer items-center text-meta text-dim"
      >Seed agent 4 completed</summary
    >
    <pre class="py-1 text-meta break-words whitespace-pre-wrap text-dim">{text}</pre>
  </details>
{/snippet}

{#snippet error(text: string)}
  {#if errorShape === "card"}
    <div class="border-l-2 border-danger/70 bg-danger/5 py-1.5 pl-3">
      <p class="text-meta tracking-wider text-danger uppercase">error</p>
      <p class="text-body break-words whitespace-pre-wrap text-danger">{text}</p>
    </div>
  {:else}
    <div class="-mr-9 border-y border-danger/40 bg-danger/5 py-1.5">
      <p class="text-meta tracking-wider text-danger uppercase">error</p>
      <p class="text-body break-words whitespace-pre-wrap text-danger">{text}</p>
    </div>
  {/if}
{/snippet}

<p class="mb-4 text-meta text-dim">
  B — hairline rail plus a reserved right gutter; copy floats in the gutter. The thinking row's own
  copy sits inside the content column, a gutter width to the left of the message's.
</p>

<div class="space-y-5">
  <article class="relative border-l-2 border-accent/70 pr-9 pl-3">
    <CopyButton text={USER_TEXT} label="Copy message" class="absolute top-0 right-0 size-8" />
    <p class="text-body break-words whitespace-pre-wrap">{USER_TEXT}</p>
  </article>

  <article class="relative border-l-2 border-hairline-strong pr-9 pl-3">
    <CopyButton text={PARAGRAPH} label="Copy message" class="absolute top-0 right-0 size-8" />
    <div class="mb-2 border-y border-hairline py-1">
      <ThinkingRow text={THINKING_TEXT} />
    </div>
    <p class="text-body break-words">{PARAGRAPH}</p>
    <p class="mt-1 text-body text-dim">{TAIL}</p>
    <DataTable rows={TABLE} />
    <CodeBlock code={CODE_SNIPPET} />
    <CodeBlock code={CODE_SHORT} />
    <div class="mt-2 space-y-1">
      <ToolCallCard block={DONE_CALL} />
      <ToolCallCard block={RUNNING_CALL} />
    </div>
  </article>

  <article class="relative border-l-2 border-hairline-strong pr-9 pl-3">
    <CopyButton text={PARAGRAPH} label="Copy message" class="absolute top-0 right-0 size-8" />
    <div class="mb-2 border-y border-hairline py-1">
      <ThinkingRow text={THINKING_TEXT} open />
    </div>
    <p class="text-body break-words">Holding here. Say the word for 61 and then 62.</p>
    <div class="mt-2">
      <ToolCallCard block={FAILED_CALL} />
    </div>
  </article>

  <article class="relative border-l-2 border-hairline-strong pr-9 pl-3">
    <div class="border-y border-hairline py-1">
      <ThinkingRow text={THINKING_TEXT} />
    </div>
  </article>

  <div class="space-y-3">
    {@render error(NETWORK_ERROR)}
    {@render error(CONNECTION_ERROR)}
  </div>

  <div class="space-y-3">
    {@render notification(NOTIFICATION_PAYLOAD)}
    {@render notification(NOTIFICATION_PAYLOAD, true)}
  </div>
</div>
