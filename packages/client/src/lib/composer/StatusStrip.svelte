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
-->
<div
  class="flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-neutral-400"
  data-testid="composer-status"
>
  <button
    type="button"
    class="min-h-11 shrink-0 rounded px-2 text-left"
    aria-haspopup="listbox"
    aria-expanded={open === "model"}
    aria-label="Model"
    data-testid="model-picker-toggle"
    onclick={() => {
      onOpenChange(open === "model" ? null : "model");
    }}
  >
    <span data-testid="status-model">{settings.model?.name ?? "No model"}</span>
  </button>
  <button
    type="button"
    class="min-h-11 shrink-0 rounded px-2 text-left"
    aria-haspopup="listbox"
    aria-expanded={open === "thinking"}
    aria-label="Thinking level"
    data-testid="thinking-picker-toggle"
    onclick={() => {
      onOpenChange(open === "thinking" ? null : "thinking");
    }}
  >
    <span data-testid="status-thinking">{levelLabel(settings.thinkingLevel)}</span>
  </button>
  <button
    type="button"
    class="min-h-11 shrink-0 rounded px-2"
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
      class="absolute bottom-24 left-2 z-10 max-h-64 w-64 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 py-1"
      role="listbox"
      aria-label="Models"
      data-testid="model-options"
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
      class="absolute bottom-24 left-2 z-10 max-h-64 w-40 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 py-1"
      role="listbox"
      aria-label="Thinking levels"
      data-testid="thinking-options"
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
