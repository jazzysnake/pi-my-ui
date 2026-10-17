<script lang="ts">
  import type { SessionStats } from "@pi-my-ui/protocol";

  let { stats }: { stats: SessionStats } = $props();

  /** The one text a value pi did not report renders as, so a missing figure is never a zero. */
  const UNAVAILABLE = "unavailable";

  function contextValue(value: SessionStats): string {
    const usage = value.contextUsage;
    if (usage === null || usage.tokens === null) {
      return UNAVAILABLE;
    }
    const percent = usage.percent === null ? "" : ` (${usage.percent.toFixed(1)}%)`;
    return `${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()}${percent}`;
  }

  const rows = $derived([
    { key: "session-id", label: "Session", value: stats.sessionId },
    { key: "messages", label: "Messages", value: stats.totalMessages.toLocaleString() },
    { key: "user-messages", label: "User messages", value: stats.userMessages.toLocaleString() },
    {
      key: "assistant-messages",
      label: "Assistant messages",
      value: stats.assistantMessages.toLocaleString(),
    },
    { key: "tool-calls", label: "Tool calls", value: stats.toolCalls.toLocaleString() },
    {
      key: "tokens",
      label: "Tokens",
      value: `${stats.tokens.input.toLocaleString()} in · ${stats.tokens.output.toLocaleString()} out`,
    },
    { key: "cost", label: "Cost", value: `$${stats.cost.toFixed(2)}` },
    { key: "context", label: "Context", value: contextValue(stats) },
  ]);
</script>

<dl class="grid grid-cols-2 gap-x-3 gap-y-1" data-testid="session-stats-panel">
  {#each rows as row (row.key)}
    <dt class="text-neutral-500" data-stat={row.key}>{row.label}</dt>
    <dd class="text-neutral-200" data-stat={row.key}>
      <span data-testid="session-stats-value">{row.value}</span>
    </dd>
  {/each}
</dl>
