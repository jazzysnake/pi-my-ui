<script lang="ts">
  import type { ContextUsage } from "@pi-my-ui/protocol";

  import { contextMeter } from "./context-usage.js";

  let { usage }: { usage: ContextUsage | null } = $props();

  const meter = $derived(contextMeter(usage));

  const TONES: Readonly<Record<string, string>> = {
    warning: "text-warning",
    critical: "text-danger",
  };
</script>

<!--
  A readout, not a control: it has no tap target, so it can sit in the session bar beside the
  connection dot without competing with a thumb. The state is on the element because that is what a
  reader (and a test) can assert about a figure pi is recomputing.
-->
<span
  class={`shrink-0 text-meta ${TONES[meter.state] ?? "text-dim"}`}
  aria-label="Context usage"
  data-testid="context-usage"
  data-state={meter.state}
>
  {meter.text}
</span>
