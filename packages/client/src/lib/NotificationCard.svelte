<script lang="ts">
  import type { ProjectedEntry } from "@pi-my-ui/protocol";

  import { entryText, notificationSummary } from "./transcript.js";

  let { entry }: { entry: ProjectedEntry } = $props();

  const text = $derived(entryText(entry));
  const summary = $derived(notificationSummary(text));
</script>

<details class="mb-1 rounded border border-hairline" data-testid="notification-card">
  <summary
    class="flex min-h-11 cursor-pointer items-center px-2 text-meta text-dim"
    data-testid="notification-summary">{summary}</summary
  >
  <pre
    class="max-w-full overflow-x-auto border-t border-hairline px-2 py-1 text-meta break-words whitespace-pre-wrap text-dim"
    data-testid="notification-payload">{text}</pre>
</details>
