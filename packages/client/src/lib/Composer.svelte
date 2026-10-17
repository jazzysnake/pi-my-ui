<script lang="ts">
  import {
    RunStateKind,
    StreamingBehavior,
    type CommandInfo,
    type ImageAttachment,
    type RunState,
    type SettingsMessage,
    type ThinkingLevel,
  } from "@pi-my-ui/protocol";

  import BashModeIndicator from "./bash/BashModeIndicator.svelte";
  import * as bash from "./bash/mode.js";
  import CommandPalette from "./CommandPalette.svelte";
  import RunningControls from "./composer/RunningControls.svelte";
  import StatusStrip from "./composer/StatusStrip.svelte";
  import {
    AttachmentRejection,
    addAttachments,
    createAttachmentIds,
    releaseAttachment,
    toImageAttachments,
    type ComposerAttachment,
  } from "./composer/attachments.js";
  import { BuiltinCommand } from "./commands/builtins.js";
  import { buildPaletteEntries, completionText, filterPaletteEntries } from "./commands/palette.js";
  import { ComposerRouteKind, paletteQuery, routeComposerSubmission } from "./commands/router.js";
  import { tuiOnlyRefusalMessage } from "./commands/tui-only.js";
  import SteerStatus from "./subagents/SteerStatus.svelte";
  import {
    STEER_ATTACHMENTS_MESSAGE,
    steerRefusalOf,
    type SteerTarget,
  } from "./subagents/steering.js";
  import type { SteerInFlight } from "./store/subagents.svelte.js";
  import { ConnectionStatus } from "./transport.js";

  let {
    runState,
    status,
    settings,
    commands,
    error,
    sentCount,
    onPrompt,
    onBash,
    onAbort,
    onCommand,
    onSetModel,
    onSetThinkingLevel,
    onSetAutoCompaction,
    onBranch,
    steerTarget = null,
    steerInFlight = null,
    onSteer = () => undefined,
    text = $bindable(""),
    onEscape,
  }: {
    runState: RunState;
    status: ConnectionStatus;
    settings: SettingsMessage | null;
    /** The Session's discoverable commands, merged into the palette with the built-ins. */
    commands: readonly CommandInfo[];
    error: string | null;
    sentCount: number;
    onPrompt: (
      text: string,
      images: readonly ImageAttachment[],
      behavior?: StreamingBehavior,
    ) => void;
    onAbort: () => void;
    /** Run a `!`/`!!` shell command; `excludeFromContext` keeps `!!` output out of the model's context. */
    onBash: (command: string, excludeFromContext: boolean) => void;
    /** Run a built-in whose action lives outside the composer, with the text after its name. */
    onCommand: (command: BuiltinCommand, args: string) => void;
    onSetModel: (provider: string, modelId: string) => void;
    onSetThinkingLevel: (level: ThinkingLevel) => void;
    onSetAutoCompaction: (enabled: boolean) => void;
    onBranch: () => void;
    /** The focused agent a typed message would steer, or `null` while the Session's view is shown. */
    steerTarget?: SteerTarget | null;
    /** The focused agent's undelivered steer, shown here until pi delivers it. */
    steerInFlight?: SteerInFlight | null;
    /** Hand one message to the focused subagent instead of the Session. */
    onSteer?: (agentId: string, message: string) => void;
    /** The draft itself, so a view can put a message back here for editing and resubmitting. */
    text?: string;
    /** Consume Escape before the composer does; returns whether it was handled. */
    onEscape?: (() => boolean) | undefined;
  } = $props();

  let attachments = $state<readonly ComposerAttachment[]>([]);
  /** The user's visible choice for a message sent during a run; `steer` interrupts by default. */
  let streamingChoice = $state<StreamingBehavior>(StreamingBehavior.Steer);
  let fileInput = $state<HTMLInputElement | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let statusPicker = $state<"model" | "thinking" | null>(null);
  /** The palette row the Enter, Tab and tap gestures all act on. */
  let highlighted = $state(0);
  /** Set by Escape and by a completion, so a dismissed palette does not reopen on the same text. */
  let paletteDismissed = $state(false);
  /**
   * The `sentCount` the composer saw when it handed pi a message, or `null` when nothing is in
   * flight. Clearing waits for the count to pass it, so the draft survives a refused message.
   */
  let pendingFrom = $state<number | null>(null);
  const nextAttachmentId = createAttachmentIds();

  const running = $derived(
    runState.kind === RunStateKind.Streaming || runState.kind === RunStateKind.Retrying,
  );
  const connected = $derived(status === ConnectionStatus.Connected);
  const hasContent = $derived(text.trim() !== "" || attachments.length > 0);
  const steerRefusal = $derived(steerRefusalOf(steerTarget));
  const canSend = $derived(
    connected && pendingFrom === null && hasContent && steerRefusal === null,
  );

  const query = $derived(paletteQuery(text));
  const paletteEntries = $derived(
    query === null || paletteDismissed
      ? []
      : filterPaletteEntries(buildPaletteEntries(commands), query),
  );
  const paletteOpen = $derived(paletteEntries.length > 0);
  const activeIndex = $derived(
    paletteEntries.length === 0 ? 0 : Math.min(highlighted, paletteEntries.length - 1),
  );

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

  // A picker left open across a session switch would offer the previous Session's models; the
  // settings going away is the switch's signal.
  $effect(() => {
    if (settings === null) {
      statusPicker = null;
    }
  });

  function releaseAll(): void {
    attachments.forEach((attachment) => releaseAttachment(attachment));
    attachments = [];
    text = "";
  }

  /** Reset the palette highlight on every keystroke, so it always points at the first best match. */
  function handleInput(): void {
    highlighted = 0;
    paletteDismissed = false;
  }

  function choose(entry: { readonly name: string }): void {
    text = completionText(entry.name);
    paletteDismissed = true;
    highlighted = 0;
    textarea?.focus();
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

  /**
   * One submission, three meanings. A prompt goes to pi; a built-in runs its action; a TUI-only
   * command is refused here and never reaches the model. The two status controls are consumed by the
   * composer's own pickers, so `/model` and a tap on the strip open the same list.
   */
  function submit(behavior?: StreamingBehavior): void {
    if (!canSend) {
      return;
    }
    // A shell command is intercepted before the slash router: `!/foo` is a shell command, not a
    // built-in, and the command is sent verbatim once the glyph is stripped.
    const bashFailure = bash.submitBashCommand(text, attachments.length, (command, exclude) => {
      releaseAll();
      onBash(command, exclude);
    });
    if (bashFailure !== undefined) {
      localError = bashFailure;
      return;
    }
    const route = routeComposerSubmission(text);
    if (route.kind === ComposerRouteKind.TuiOnly) {
      localError = tuiOnlyRefusalMessage(route.name);
      return;
    }
    if (route.kind === ComposerRouteKind.Builtin) {
      if (route.command === BuiltinCommand.Model || route.command === BuiltinCommand.Thinking) {
        releaseAll();
        localError = null;
        statusPicker = route.command === BuiltinCommand.Model ? "model" : "thinking";
        return;
      }
      releaseAll();
      localError = null;
      onCommand(route.command, route.args);
      return;
    }
    // A plain message while an agent's conversation is shown is a steer, not a prompt to the
    // Session: the reader is addressing the agent in front of them. Slash commands and `!` keep
    // their own routes above, so `/tree` still opens the tree with an agent focused.
    if (steerTarget !== null) {
      if (attachments.length > 0) {
        localError = STEER_ATTACHMENTS_MESSAGE;
        return;
      }
      // The steer is handed over and not echoed back by pi, so the draft is released now; a refusal
      // arrives as the composer's error line rather than leaving the text silently in place.
      const message = text;
      releaseAll();
      localError = null;
      onSteer(steerTarget.agentId, message);
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
    if (paletteOpen && event.key === "Enter") {
      const entry = paletteEntries[activeIndex];
      if (entry !== undefined) {
        event.preventDefault();
        choose(entry);
      }
      return;
    }
    if (paletteOpen && event.key === "Tab") {
      const entry = paletteEntries[activeIndex];
      if (entry !== undefined) {
        // Consuming Tab keeps focus in the composer, which is what lets the arguments be typed next.
        event.preventDefault();
        choose(entry);
      }
      return;
    }
    if (paletteOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const step = event.key === "ArrowDown" ? 1 : paletteEntries.length - 1;
      highlighted = (activeIndex + step) % paletteEntries.length;
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      // The palette owns the first Escape when it is open, so it can dismiss without aborting.
      if (onEscape?.() === true) {
        event.preventDefault();
        return;
      }
      if (paletteOpen) {
        paletteDismissed = true;
        event.preventDefault();
        return;
      }
      if (running) {
        event.preventDefault();
        onAbort();
      }
    }
  }
</script>

<section
  aria-label="Composer"
  class="flex flex-col gap-2 border-t border-neutral-800 p-2"
  data-testid="composer"
>
  {#if settings !== null}
    <StatusStrip
      {settings}
      open={statusPicker}
      onOpenChange={(next) => {
        statusPicker = next;
      }}
      {onSetModel}
      {onSetThinkingLevel}
      {onSetAutoCompaction}
    />
  {/if}

  {#if running}
    <RunningControls
      {steerTarget}
      choice={streamingChoice}
      {canSend}
      onChoose={(behavior) => {
        streamingChoice = behavior;
      }}
      onSend={() => {
        submit(streamingChoice);
      }}
    />
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

  <BashModeIndicator {text} />

  <SteerStatus refusal={steerRefusal} target={steerTarget} inFlight={steerInFlight} />

  {#if visibleError !== null}
    <p class="text-xs text-red-400" role="alert" data-testid="composer-error">{visibleError}</p>
  {/if}

  {#if paletteOpen}
    <CommandPalette entries={paletteEntries} highlighted={activeIndex} onChoose={choose} />
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
      bind:this={textarea}
      class="min-h-11 min-w-0 flex-1 resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
      rows="1"
      placeholder="Message pi"
      aria-label="Message"
      data-testid="composer-input"
      bind:value={text}
      oninput={handleInput}
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
