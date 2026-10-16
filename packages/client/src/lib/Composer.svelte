<script lang="ts">
  import { RunStateKind, type RunState } from "@pi-my-ui/protocol";

  import { ConnectionStatus } from "./transport.js";

  let {
    runState,
    status,
    onPrompt,
    onAbort,
  }: {
    runState: RunState;
    status: ConnectionStatus;
    onPrompt: (text: string) => void;
    onAbort: () => void;
  } = $props();

  let text = $state("");

  const running = $derived(
    runState.kind === RunStateKind.Streaming || runState.kind === RunStateKind.Retrying,
  );
  const connected = $derived(status === ConnectionStatus.Connected);
  const canSend = $derived(connected && !running && text.trim() !== "");
</script>

<form
  class="flex items-end gap-2 border-t border-neutral-800 p-2"
  data-testid="composer"
  onsubmit={(event) => {
    event.preventDefault();
    if (running) {
      onAbort();
      return;
    }
    if (!canSend) {
      return;
    }
    const message = text;
    text = "";
    onPrompt(message);
  }}
>
  <textarea
    class="min-h-11 min-w-0 flex-1 resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
    rows="1"
    placeholder="Message pi"
    aria-label="Message"
    data-testid="composer-input"
    bind:value={text}></textarea>
  <button
    type="submit"
    class="grid size-11 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm font-medium text-neutral-900 disabled:opacity-40"
    disabled={!running && !canSend}
    data-testid="composer-send"
  >
    {running ? "Stop" : "Send"}
  </button>
</form>
