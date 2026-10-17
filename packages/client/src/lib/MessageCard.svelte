<script lang="ts">
  import {
    ContentBlockType,
    MessageRole,
    type ContentBlock,
    type ProjectedMessageEntry,
  } from "@pi-my-ui/protocol";

  import BashCard from "./BashCard.svelte";
  import CopyButton from "./CopyButton.svelte";
  import Markdown from "./Markdown.svelte";
  import ThinkingRow from "./ThinkingRow.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import { entryText } from "./transcript.js";

  let { entry }: { entry: ProjectedMessageEntry } = $props();

  const copyText = $derived(entryText(entry));
  const raised = $derived(entry.role === MessageRole.User);
  /**
   * The control's box, reserved by whatever the card draws first. A copyable card also keeps enough
   * height for the 44 px box and its 2 px inset on both edges, so a one-line message cannot push the
   * control past the border.
   */
  const COPY_COLUMN = "44px";
</script>

{#snippet blockBody(block: ContentBlock)}
  {#if block.type === ContentBlockType.Text}
    {#if entry.role === MessageRole.Assistant}
      <Markdown text={block.text} />
    {:else}
      <p class="text-body break-words whitespace-pre-wrap">{block.text}</p>
    {/if}
  {:else if block.type === ContentBlockType.Reasoning}
    <ThinkingRow text={block.text} />
  {:else if block.type === ContentBlockType.ToolCall}
    <ToolCallCard {block} />
  {:else if block.type === ContentBlockType.BashExecution}
    <BashCard {block} />
  {/if}
{/snippet}

<article
  class={`relative rounded border px-2.5 pt-1.5 pb-2.5 ${
    raised ? "border-hairline-strong bg-panel-raised" : "border-hairline bg-panel"
  } ${copyText === "" ? "" : "min-h-12"}`}
  data-testid="message-card"
  data-surface={raised ? "raised" : "panel"}
  data-role={entry.role}
>
  {#if copyText !== ""}
    <CopyButton
      text={copyText}
      label="Copy message"
      class="absolute top-0.5 right-0.5 size-11"
      testId="copy-message"
    />
  {/if}
  {#each entry.blocks as block, index (index)}
    {#if index === 0}
      <div
        class="min-w-0"
        style:padding-right={copyText === "" ? "0px" : COPY_COLUMN}
        data-testid="message-card-first-block"
      >
        {@render blockBody(block)}
      </div>
    {:else}
      {@render blockBody(block)}
    {/if}
  {/each}
</article>
