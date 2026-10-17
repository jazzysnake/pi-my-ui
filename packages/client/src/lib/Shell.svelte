<script lang="ts">
  import type { ImageAttachment, StreamingBehavior, ThinkingLevel } from "@pi-my-ui/protocol";

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
    onSetModel = () => undefined,
    onSetThinkingLevel = () => undefined,
    onSetAutoCompaction = () => undefined,
    onBranch = () => undefined,
    onListDirectory,
    onPreviewFile,
    onDownloadFile,
    onCreateSession = () => undefined,
  }: {
    store: ClientStore;
    status: ConnectionStatus;
    onSelectSession: (sessionId: string) => void;
    onPrompt: (
      text: string,
      images: readonly ImageAttachment[],
      behavior?: StreamingBehavior,
    ) => void;
    onAbort: () => void;
    onSetModel?: (provider: string, modelId: string) => void;
    onSetThinkingLevel?: (level: ThinkingLevel) => void;
    onSetAutoCompaction?: (enabled: boolean) => void;
    onBranch?: () => void;
    onListDirectory: (path: string) => void;
    onPreviewFile: (path: string) => void;
    onDownloadFile: (path: string) => void;
    onCreateSession?: () => void;
  } = $props();

  let filesOpen = $state(false);
  let sessionsOpen = $state(false);

  // The Shell owns the composer-to-store interaction: every send is recorded before the transport
  // is asked, so the composer can tell pi's acceptance from a refusal.
  function handlePrompt(
    text: string,
    images: readonly ImageAttachment[],
    behavior?: StreamingBehavior,
  ): void {
    store.composer.noteSend();
    onPrompt(text, images, behavior);
  }
</script>

<div
  class="relative flex h-dvh flex-col overflow-hidden bg-neutral-950 text-neutral-100"
  data-testid="app-shell"
  data-session-id={store.sessions.activeSessionId ?? undefined}
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
  <Composer
    runState={store.transcript.runState}
    {status}
    settings={store.settings.settings}
    error={store.composer.error}
    sentCount={store.composer.sentCount}
    onPrompt={handlePrompt}
    {onAbort}
    {onSetModel}
    {onSetThinkingLevel}
    {onSetAutoCompaction}
    {onBranch}
  />
  {#if sessionsOpen}
    <SessionDrawer
      rows={store.sessions.rows}
      activeSessionId={store.sessions.activeSessionId}
      onSelect={onSelectSession}
      {onCreateSession}
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
