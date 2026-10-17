<script lang="ts">
  import {
    RunStateKind,
    StreamingBehavior,
    type ImageAttachment,
    type RunState,
    type SettingsMessage,
    type ThinkingLevel,
  } from "@pi-my-ui/protocol";

  import StatusStrip from "./composer/StatusStrip.svelte";
  import {
    AttachmentRejection,
    addAttachments,
    releaseAttachment,
    toImageAttachments,
    type ComposerAttachment,
  } from "./composer/attachments.js";
  import { ConnectionStatus } from "./transport.js";

  let {
    runState,
    status,
    settings,
    error,
    sentCount,
    onPrompt,
    onAbort,
    onSetModel,
    onSetThinkingLevel,
    onSetAutoCompaction,
    onBranch,
    onEscape,
  }: {
    runState: RunState;
    status: ConnectionStatus;
    settings: SettingsMessage | null;
    error: string | null;
    sentCount: number;
    onPrompt: (
      text: string,
      images: readonly ImageAttachment[],
      behavior?: StreamingBehavior,
    ) => void;
    onAbort: () => void;
    onSetModel: (provider: string, modelId: string) => void;
    onSetThinkingLevel: (level: ThinkingLevel) => void;
    onSetAutoCompaction: (enabled: boolean) => void;
    onBranch: () => void;
    /** Consume Escape before the composer does; returns whether it was handled. */
    onEscape?: (() => boolean) | undefined;
  } = $props();

  let text = $state("");
  let attachments = $state<readonly ComposerAttachment[]>([]);
  /** The user's visible choice for a message sent during a run; `steer` interrupts by default. */
  let streamingChoice = $state<StreamingBehavior>(StreamingBehavior.Steer);
  let fileInput = $state<HTMLInputElement | null>(null);
  /**
   * The `sentCount` the composer saw when it handed pi a message, or `null` when nothing is in
   * flight. Clearing waits for the count to pass it, so the draft survives a refused message.
   */
  let pendingFrom = $state<number | null>(null);
  let attachmentId = 0;

  const running = $derived(
    runState.kind === RunStateKind.Streaming || runState.kind === RunStateKind.Retrying,
  );
  const connected = $derived(status === ConnectionStatus.Connected);
  const hasContent = $derived(text.trim() !== "" || attachments.length > 0);
  const canSend = $derived(connected && pendingFrom === null && hasContent);

  // The composer clears only once pi has accepted the message: its echo appears in the transcript as
  // the user's own entry. A refused message produces no entry, so the text and images stay put.
  $effect(() => {
    if (pendingFrom !== null && sentCount > pendingFrom) {
      pendingFrom = null;
      releaseAll();
    }
  });

  // A refused send re-enables the controls with the draft intact.
  $effect(() => {
    if (error !== null) {
      pendingFrom = null;
    }
  });

  function releaseAll(): void {
    for (const attachment of attachments) {
      releaseAttachment(attachment);
    }
    attachments = [];
    text = "";
  }

  function nextAttachmentId(): string {
    attachmentId += 1;
    return `attachment-${String(attachmentId)}`;
  }

  async function handleFilesChosen(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files === null ? [] : [...input.files];
    try {
      attachments = await addAttachments(attachments, files, nextAttachmentId);
    } catch (rejection) {
      // A refused file is shown where the user is looking, not thrown away.
      if (rejection instanceof AttachmentRejection) {
        onPromptError(rejection.message);
      }
    } finally {
      // Clear the picker so choosing the same file again still fires `change`.
      input.value = "";
    }
  }

  // A rejected attachment is reported through the same line as a rejected message, so the composer
  // has one error area rather than two.
  let localError = $state<string | null>(null);
  function onPromptError(message: string): void {
    localError = message;
  }
  const visibleError = $derived(localError ?? error);

  function removeAttachment(attachment: ComposerAttachment): void {
    releaseAttachment(attachment);
    attachments = attachments.filter((candidate) => candidate.id !== attachment.id);
    localError = null;
  }

  function submit(behavior?: StreamingBehavior): void {
    if (!canSend) {
      return;
    }
    localError = null;
    onPrompt(text, toImageAttachments(attachments), behavior);
    pendingFrom = sentCount;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit(running ? streamingChoice : undefined);
      return;
    }
    if (event.key === "Escape") {
      // The palette owns the first Escape when it is open, so it can dismiss without aborting.
      if (onEscape?.() === true) {
        event.preventDefault();
        return;
      }
      if (running) {
        event.preventDefault();
        onAbort();
      }
      return;
    }
  }
</script>

<section
  aria-label="Composer"
  class="flex flex-col gap-2 border-t border-neutral-800 p-2"
  data-testid="composer"
>
  {#if settings !== null}
    <StatusStrip {settings} {onSetModel} {onSetThinkingLevel} {onSetAutoCompaction} />
  {/if}

  {#if running}
    <div class="flex items-center gap-1" role="group" aria-label="While running">
      <span class="shrink-0 text-xs tracking-wider text-neutral-500 uppercase">While running</span>
      <button
        type="button"
        class="min-h-11 rounded border px-2 text-xs"
        class:border-neutral-100={streamingChoice === StreamingBehavior.Steer}
        class:text-neutral-100={streamingChoice === StreamingBehavior.Steer}
        class:border-neutral-700={streamingChoice !== StreamingBehavior.Steer}
        class:text-neutral-400={streamingChoice !== StreamingBehavior.Steer}
        aria-pressed={streamingChoice === StreamingBehavior.Steer}
        aria-describedby="streaming-choice-hint"
        data-testid="streaming-choice-steer"
        onclick={() => {
          streamingChoice = StreamingBehavior.Steer;
        }}
      >
        Steer
      </button>
      <button
        type="button"
        class="min-h-11 rounded border px-2 text-xs"
        class:border-neutral-100={streamingChoice === StreamingBehavior.FollowUp}
        class:text-neutral-100={streamingChoice === StreamingBehavior.FollowUp}
        class:border-neutral-700={streamingChoice !== StreamingBehavior.FollowUp}
        class:text-neutral-400={streamingChoice !== StreamingBehavior.FollowUp}
        aria-pressed={streamingChoice === StreamingBehavior.FollowUp}
        aria-describedby="streaming-choice-hint"
        data-testid="streaming-choice-follow-up"
        onclick={() => {
          streamingChoice = StreamingBehavior.FollowUp;
        }}
      >
        Follow up
      </button>
      <button
        type="button"
        class="ml-auto grid size-11 shrink-0 place-items-center rounded-full border border-neutral-700 text-sm"
        aria-label="Send while running"
        disabled={!canSend}
        data-testid="composer-send-while-running"
        onclick={() => {
          submit(streamingChoice);
        }}
      >
        Send
      </button>
    </div>
    <p
      id="streaming-choice-hint"
      class="text-xs text-neutral-500"
      data-testid="streaming-choice-hint"
    >
      Steer: goes into this run at its next step · Follow up: waits until this run finishes
    </p>
  {/if}

  {#if attachments.length > 0}
    <ul class="flex flex-wrap items-start gap-3" aria-label="Attachments">
      {#each attachments as attachment (attachment.id)}
        <li class="relative" data-testid="attachment">
          <img
            src={attachment.objectUrl}
            alt={attachment.fileName}
            class="h-11 w-11 rounded border border-neutral-700 object-cover"
          />
          <button
            type="button"
            class="absolute -top-3 -right-3 grid size-11 place-items-center"
            aria-label={`Remove ${attachment.fileName}`}
            onclick={() => {
              removeAttachment(attachment);
            }}
          >
            <span
              class="grid size-6 place-items-center rounded-full border border-neutral-700 bg-neutral-900"
              aria-hidden="true">×</span
            >
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if visibleError !== null}
    <p class="text-xs text-red-400" role="alert" data-testid="composer-error">{visibleError}</p>
  {/if}

  <div class="flex items-end gap-2">
    <input
      bind:this={fileInput}
      class="sr-only"
      type="file"
      accept="image/*"
      multiple
      aria-label="Attach image file"
      data-testid="composer-attach-input"
      onchange={(event) => {
        void handleFilesChosen(event);
      }}
    />
    <textarea
      class="min-h-11 min-w-0 flex-1 resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
      rows="1"
      placeholder="Message pi"
      aria-label="Message"
      data-testid="composer-input"
      bind:value={text}
      onkeydown={handleKeydown}></textarea>
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded border border-neutral-700 text-sm"
      aria-label="Attach image"
      data-testid="composer-attach"
      onclick={() => {
        fileInput?.click();
      }}
    >
      Attach
    </button>
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center border border-neutral-700 text-sm"
      aria-label="Branch"
      data-testid="composer-branch"
      onclick={onBranch}
    >
      Branch
    </button>
    {#if running}
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded-full border border-neutral-700 text-sm"
        aria-label="Stop"
        data-testid="composer-send"
        onclick={onAbort}
      >
        Stop
      </button>
    {:else}
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm font-medium text-neutral-900 disabled:opacity-40"
        disabled={!canSend}
        data-testid="composer-send"
        onclick={() => {
          submit();
        }}
      >
        Send
      </button>
    {/if}
  </div>
</section>
