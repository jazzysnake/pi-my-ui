<script lang="ts">
  import Composer from "./Composer.svelte";
  import ConnectionStatusIndicator from "./ConnectionStatusIndicator.svelte";
  import RunStateRow from "./RunStateRow.svelte";
  import SessionDrawer from "./SessionDrawer.svelte";
  import Transcript from "./Transcript.svelte";
  import FileTreePanel from "./files/FileTreePanel.svelte";
  import { ROOT_PATH } from "./files/rows.js";
  import type { ClientStore } from "./store/client-store.svelte.js";
  import type { ConnectionStatus } from "./transport.js";

  let {
    store,
    status,
    onSelectSession,
    onPrompt,
    onAbort,
    onListDirectory,
    onPreviewFile,
    onDownloadFile,
  }: {
    store: ClientStore;
    status: ConnectionStatus;
    onSelectSession: (sessionId: string) => void;
    onPrompt: (text: string) => void;
    onAbort: () => void;
    onListDirectory: (path: string) => void;
    onPreviewFile: (path: string) => void;
    onDownloadFile: (path: string) => void;
  } = $props();

  let filesOpen = $state(false);
  let sessionsOpen = $state(false);
</script>

<div
  class="relative flex h-dvh flex-col overflow-hidden bg-neutral-950 text-neutral-100"
  data-testid="app-shell"
>
  <header class="flex items-center gap-2 border-b border-neutral-800 px-3 py-1">
    <span class="text-sm font-semibold tracking-wide uppercase">pi-my-ui</span>
    <button
      type="button"
      class="min-h-11 rounded px-2 text-xs text-neutral-300"
      aria-label="Toggle sessions sidebar"
      data-testid="sessions-toggle"
      onclick={() => {
        sessionsOpen = !sessionsOpen;
      }}
    >
      Sessions
    </button>
    <button
      type="button"
      class="min-h-11 rounded px-2 text-xs text-neutral-300"
      data-testid="files-toggle"
      onclick={() => {
        filesOpen = !filesOpen;
        if (filesOpen) {
          onListDirectory(ROOT_PATH);
        }
      }}
    >
      Files
    </button>
    <div class="ml-auto">
      <ConnectionStatusIndicator {status} />
    </div>
  </header>
  <Transcript entries={store.transcript.entries} />
  <RunStateRow runState={store.transcript.runState} />
  <Composer runState={store.transcript.runState} {status} {onPrompt} {onAbort} />
  {#if sessionsOpen}
    <SessionDrawer
      summaries={store.sessions.summaries}
      activeSessionId={store.sessions.activeSessionId}
      onSelect={onSelectSession}
      onClose={() => {
        sessionsOpen = false;
      }}
    />
  {/if}
  {#if filesOpen}
    <FileTreePanel
      cwd={store.transcript.cwd}
      files={store.files}
      onClose={() => {
        filesOpen = false;
      }}
      {onListDirectory}
      {onPreviewFile}
      {onDownloadFile}
    />
  {/if}
</div>
