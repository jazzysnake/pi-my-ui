<script lang="ts">
  import type { ModelInfo, SettingsMessage, ThinkingLevel } from "@pi-my-ui/protocol";

  let {
    settings,
    open,
    onOpenChange,
    onSetModel,
    onSetThinkingLevel,
    onSetAutoCompaction,
  }: {
    settings: SettingsMessage;
    /** Which picker is open; the composer owns this so `/model` and a tap open the same one. */
    open: "model" | "thinking" | null;
    onOpenChange: (next: "model" | "thinking" | null) => void;
    onSetModel: (provider: string, modelId: string) => void;
    onSetThinkingLevel: (level: ThinkingLevel) => void;
    onSetAutoCompaction: (enabled: boolean) => void;
  } = $props();

  function chooseModel(model: ModelInfo): void {
    onOpenChange(null);
    onSetModel(model.provider, model.id);
  }

  /**
   * A tap away from the open picker dismisses it. The listener is on `pointerdown`, not `click`,
   * because most of the page is plain text: a tap on the transcript is not a click target on touch,
   * so a click listener would never hear the tap that should dismiss the list. The picker's own
   * handles and rows carry `data-picker-owned` so a tap on one reaches its click handler with the
   * list still open; dismissing on the way down would either drop a row tap or make a tap on the
   * open toggle close and reopen the same list.
   *
   * The trade-off is that a touch scroll also begins with a pointerdown, so it dismisses too. A
   * menu anchored above the input is transient, and hearing every tap is worth more than surviving
   * a scroll that started outside it.
   */
  $effect(() => {
    if (open === null) return;
    function dismiss(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-picker-owned]") !== null) return;
      onOpenChange(null);
    }
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
    };
  });

  function chooseThinking(level: ThinkingLevel): void {
    onOpenChange(null);
    onSetThinkingLevel(level);
  }

  /** Title-case a level for the picker row; the value still comes from the protocol constant. */
  function levelLabel(level: ThinkingLevel): string {
    return level.charAt(0).toUpperCase() + level.slice(1);
  }
</script>

<!--
  Every value here is pi's, read back from the server: a tap sends a change and the strip keeps
  showing the last value pi reported, so a refused change cannot look like it worked.

  The model name is the one label whose length is pi's to choose, so it is the one that gives way: it
  shrinks and ellipsizes, which keeps the toggle on the row at 320 px instead of scrolling the strip.
  A name as long as the ones pi reports ("DeepSeek V4.1 Flash") otherwise pushes the toggle 15 px
  past the row's edge.
-->
<div
  class="flex min-w-0 items-center gap-1 overflow-x-auto text-meta"
  data-testid="composer-status"
>
  <button
    type="button"
    class="min-h-11 min-w-11 truncate rounded border border-hairline-strong px-2 text-left text-accent"
    aria-haspopup="listbox"
    aria-expanded={open === "model"}
    aria-label="Model"
    data-testid="model-picker-toggle"
    data-picker-owned
    onclick={() => {
      onOpenChange(open === "model" ? null : "model");
    }}
  >
    <span data-testid="status-model">{settings.model?.name ?? "No model"}</span>
  </button>
  <button
    type="button"
    class="min-h-11 min-w-11 shrink-0 rounded border border-hairline-strong px-2 text-left text-accent"
    aria-haspopup="listbox"
    aria-expanded={open === "thinking"}
    aria-label="Thinking level"
    data-testid="thinking-picker-toggle"
    data-picker-owned
    onclick={() => {
      onOpenChange(open === "thinking" ? null : "thinking");
    }}
  >
    <span data-testid="status-thinking">{levelLabel(settings.thinkingLevel)}</span>
  </button>
  <!-- Green is the palette's tone for a thing that is on, and only while it is on: an off toggle
       keeps the plain tone, so the state is readable without reading the word. -->
  <button
    type="button"
    class="ml-auto min-h-11 min-w-11 shrink-0 rounded border px-2"
    class:border-hairline-strong={!settings.autoCompactionEnabled}
    class:text-dim={!settings.autoCompactionEnabled}
    class:border-success={settings.autoCompactionEnabled}
    class:text-success={settings.autoCompactionEnabled}
    aria-pressed={settings.autoCompactionEnabled}
    data-testid="auto-compaction-toggle"
    data-auto-compaction={settings.autoCompactionEnabled}
    onclick={() => {
      onSetAutoCompaction(!settings.autoCompactionEnabled);
    }}
  >
    Auto-compact: {settings.autoCompactionEnabled ? "On" : "Off"}
  </button>
  {#if open === "model"}
    <ul
      class="absolute bottom-24 left-2 z-10 max-h-64 w-64 overflow-y-auto rounded border border-hairline-strong bg-panel py-1"
      role="listbox"
      aria-label="Models"
      data-testid="model-options"
      data-picker-owned
    >
      {#each settings.availableModels as model (model.provider + model.id)}
        <li>
          <button
            type="button"
            class="min-h-11 w-full px-3 text-left"
            role="option"
            aria-selected={settings.model?.id === model.id &&
              settings.model.provider === model.provider}
            data-testid="model-option"
            onclick={() => {
              chooseModel(model);
            }}
          >
            {model.name}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if open === "thinking"}
    <ul
      class="absolute bottom-24 left-2 z-10 max-h-64 w-40 overflow-y-auto rounded border border-hairline-strong bg-panel py-1"
      role="listbox"
      aria-label="Thinking levels"
      data-testid="thinking-options"
      data-picker-owned
    >
      {#each settings.availableThinkingLevels as level (level)}
        <li>
          <button
            type="button"
            class="min-h-11 w-full px-3 text-left"
            role="option"
            aria-selected={settings.thinkingLevel === level}
            data-testid="thinking-option"
            data-thinking-level={level}
            onclick={() => {
              chooseThinking(level);
            }}
          >
            {levelLabel(level)}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
