<script lang="ts">
  /**
   * The name sheet: one field, Create and Cancel. It judges no name — the server owns every rule about
   * what may become a Project directory — so it sends what was typed and renders the refusal the
   * server sent, keeping the text so a correction costs no retyping.
   */
  let {
    workspace,
    error,
    busy = false,
    onCreate,
    onClose,
  }: {
    workspace: string | null;
    /** The server's refusal in the reader's words, or `null`. */
    error: string | null;
    busy?: boolean;
    onCreate: (name: string) => void;
    onClose: () => void;
  } = $props();

  let name = $state("");
  let field = $state<HTMLInputElement | null>(null);

  // A phone opens the sheet already typing, so the field takes the focus rather than the keyboard
  // waiting for a second tap.
  $effect(() => {
    field?.focus();
  });

  function submit(event: Event): void {
    event.preventDefault();
    if (busy) {
      return;
    }
    onCreate(name);
  }
</script>

<div
  class="absolute inset-0 z-50 flex flex-col bg-canvas text-ink"
  role="dialog"
  aria-modal="true"
  aria-label="New Project"
  data-testid="project-name-sheet"
>
  <form class="flex flex-col gap-3 px-4 py-3" onsubmit={submit}>
    <div>
      <span class="block text-meta tracking-wider text-dim uppercase">New Project</span>
      {#if workspace !== null}
        <span class="block text-meta text-faint" data-testid="project-name-workspace">
          Creates one folder in {workspace}
        </span>
      {/if}
    </div>
    <input
      bind:this={field}
      bind:value={name}
      class="min-h-11 w-full rounded border border-hairline-strong bg-panel px-2 text-body text-ink"
      aria-label="Project name"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      data-testid="project-name-input"
    />
    {#if error !== null}
      <p class="text-body text-warning" data-testid="project-name-error">{error}</p>
    {/if}
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="min-h-11 flex-1 rounded border border-hairline-strong px-3 text-body text-accent"
        data-testid="project-name-create"
        onclick={submit}
      >
        {busy ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        class="min-h-11 shrink-0 rounded px-3 text-body text-dim"
        data-testid="project-name-cancel"
        onclick={onClose}
      >
        Cancel
      </button>
    </div>
  </form>
</div>
