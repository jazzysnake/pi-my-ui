<script lang="ts">
  /**
   * PROTOTYPE variant C — no chrome around the row at all: a header line with the role word, a
   * hairline rule across, and the message's copy control at the rule's right end. The boundary is
   * the rule, which is stated rather than implied, at the cost of a line of height per message.
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
  <article>
    <div class="mb-1 flex items-center gap-2">
      <span class="text-meta tracking-[0.14em] text-warning uppercase">notice</span>
      <span class="h-px flex-1 bg-hairline"></span>
    </div>
    <details {open}>
      <summary class="flex min-h-9 cursor-pointer items-center text-meta text-dim"
        >Seed agent 4 completed</summary
      >
      <pre class="py-1 text-meta break-words whitespace-pre-wrap text-dim">{text}</pre>
    </details>
  </article>
{/snippet}

{#snippet error(text: string)}
  <article>
    <div class="mb-1 flex items-center gap-2">
      <span class="text-meta tracking-[0.14em] text-danger uppercase">error</span>
      <span class="h-px flex-1 bg-danger/40"></span>
    </div>
    {#if errorShape === "card"}
      <p
        class="rounded border border-danger/50 bg-danger/5 px-2 py-1.5 text-body break-words whitespace-pre-wrap text-danger"
      >
        {text}
      </p>
    {:else}
      <p class="-mx-3 bg-danger/5 py-1.5 text-body break-words whitespace-pre-wrap text-danger">
        {text}
      </p>
    {/if}
  </article>
{/snippet}

<p class="mb-4 text-meta text-dim">
  C — a named header rule per row, copy on the rule. Nothing is boxed except tool calls, which
  therefore read as a different object kind rather than as nested chrome.
</p>

<div class="space-y-5">
  <article>
    <div class="mb-1 flex items-center gap-2">
      <span class="text-meta tracking-[0.14em] text-accent uppercase">you</span>
      <span class="h-px flex-1 bg-hairline"></span>
      <CopyButton text={USER_TEXT} label="Copy message" class="size-7 -mr-1" />
    </div>
    <p class="text-body break-words whitespace-pre-wrap">{USER_TEXT}</p>
  </article>

  <article>
    <div class="mb-1 flex items-center gap-2">
      <span class="text-meta tracking-[0.14em] text-faint uppercase">assistant</span>
      <span class="h-px flex-1 bg-hairline"></span>
      <CopyButton text={PARAGRAPH} label="Copy message" class="size-7 -mr-1" />
    </div>
    <ThinkingRow text={THINKING_TEXT} ruleClass="bg-hairline" />
    <p class="mt-1 text-body break-words">{PARAGRAPH}</p>
    <p class="mt-1 text-body text-dim">{TAIL}</p>
    <DataTable rows={TABLE} />
    <CodeBlock code={CODE_SNIPPET} />
    <CodeBlock code={CODE_SHORT} />
    <div class="mt-2 space-y-1">
      <ToolCallCard block={DONE_CALL} />
      <ToolCallCard block={RUNNING_CALL} />
    </div>
  </article>

  <article>
    <div class="mb-1 flex items-center gap-2">
      <span class="text-meta tracking-[0.14em] text-faint uppercase">assistant</span>
      <span class="h-px flex-1 bg-hairline"></span>
      <CopyButton text={PARAGRAPH} label="Copy message" class="size-7 -mr-1" />
    </div>
    <ThinkingRow text={THINKING_TEXT} open ruleClass="bg-hairline" />
    <p class="mt-1 text-body break-words">Holding here. Say the word for 61 and then 62.</p>
    <div class="mt-2">
      <ToolCallCard block={FAILED_CALL} />
    </div>
  </article>

  <article>
    <div class="mb-1 flex items-center gap-2">
      <span class="text-meta tracking-[0.14em] text-faint uppercase">assistant</span>
      <span class="h-px flex-1 bg-hairline"></span>
    </div>
    <ThinkingRow text={THINKING_TEXT} ruleClass="bg-hairline" />
  </article>

  {@render error(NETWORK_ERROR)}
  {@render error(CONNECTION_ERROR)}

  {@render notification(NOTIFICATION_PAYLOAD)}
  {@render notification(NOTIFICATION_PAYLOAD, true)}
</div>
