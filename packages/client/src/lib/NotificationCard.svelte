<script lang="ts">
  import type { ProjectedEntry } from "@pi-my-ui/protocol";

  import { entryText, notificationSummary } from "./transcript.js";

  let { entry }: { entry: ProjectedEntry } = $props();

  const text = $derived(entryText(entry));
  const summary = $derived(notificationSummary(text));
</script>

<details class="mb-1 rounded border border-neutral-800" data-testid="notification-card">
  <summary
    class="cursor-pointer px-2 py-1 text-xs text-neutral-300"
    data-testid="notification-summary">{summary}</summary
  >
  <pre
    class="max-w-full overflow-x-auto border-t border-neutral-800 px-2 py-1 text-xs break-words whitespace-pre-wrap text-neutral-400"
    data-testid="notification-payload">{text}</pre>
</details>
