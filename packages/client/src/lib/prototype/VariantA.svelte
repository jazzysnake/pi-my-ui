<script lang="ts">
  /**
   * PROTOTYPE variant A — every message is a bounded, bordered card and its copy control sits in the
   * card's own top-right corner, inside the border. The card's first block gives up the copy
   * column's width, so nothing is ever drawn underneath the control. Role is carried by surface
   * (raised = you), so the accent stays reserved for links; tool calls keep their border and nest,
   * which is what keeps them a distinguishable object.
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

  /** The card's copy control, inside the corner and never straddling the border. */
  const COPY = "absolute top-0.5 right-0.5 size-11";
  /** What the card's first block reserves so the control is never on top of content. */
  const YIELD = "pr-11";
  /** A thinking row keeps its own hairline box, narrowed to end clear of the copy column. */
  const THINKING = "mb-2 mr-10 rounded border border-hairline bg-canvas px-1.5";
</script>

{#snippet notification(text: string, open = false)}
  <details class="rounded border border-hairline" {open}>
    <summary class="flex min-h-11 cursor-pointer items-center px-2 text-meta text-dim"
      >Seed agent 4 completed</summary
    >
    <pre
      class="border-t border-hairline px-2 py-1 text-meta break-words whitespace-pre-wrap text-dim">{text}</pre>
  </details>
{/snippet}

{#snippet error(text: string)}
  {#if errorShape === "card"}
    <div class="rounded border border-danger/50 bg-danger/5 px-2.5 py-2">
      <p class="text-meta tracking-wider text-danger uppercase">error</p>
      <p class="mt-0.5 text-body break-words whitespace-pre-wrap text-danger">{text}</p>
    </div>
  {:else}
    <div class="-mx-3 border-y border-danger/40 bg-danger/5 px-3 py-2">
      <p class="text-meta tracking-wider text-danger uppercase">error</p>
      <p class="mt-0.5 text-body break-words whitespace-pre-wrap text-danger">{text}</p>
    </div>
  {/if}
{/snippet}

<!-- The legend is prototype scaffolding, not part of the design being judged. -->
<p class="mb-4 text-meta text-dim">
  A — bordered card per message; copy sits in the card's top-right corner, inside the border, and
  the first block yields that column. A thinking row keeps its own box and ends short of the copy
  column; tool calls keep theirs, so nesting reads as message &gt; thinking &gt; call.
</p>

<div class="space-y-5">
  <article
    class="relative rounded border border-hairline-strong bg-panel-raised px-2.5 pt-1.5 pb-2.5"
  >
    <CopyButton text={USER_TEXT} label="Copy message" class={COPY} />
    <p class={`text-body break-words whitespace-pre-wrap ${YIELD}`}>{USER_TEXT}</p>
  </article>

  <article class="relative rounded border border-hairline bg-panel px-2.5 pt-1.5 pb-2.5">
    <CopyButton text={PARAGRAPH} label="Copy message" class={COPY} />
    <div class={THINKING}>
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

  <article class="relative rounded border border-hairline bg-panel px-2.5 pt-1.5 pb-2.5">
    <CopyButton text={PARAGRAPH} label="Copy message" class={COPY} />
    <div class={THINKING}>
      <ThinkingRow text={THINKING_TEXT} open />
    </div>
    <p class="text-body break-words">Holding here. Say the word for 61 and then 62.</p>
    <div class="mt-2">
      <ToolCallCard block={FAILED_CALL} />
    </div>
  </article>

  <!-- A thinking-only message has nothing a copy would carry, so it has no control and the thinking
       row uses the full width. -->
  <article class="relative rounded border border-hairline bg-panel px-2.5 pt-1.5 pb-2.5">
    <div class="rounded border border-hairline bg-canvas px-1.5">
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
