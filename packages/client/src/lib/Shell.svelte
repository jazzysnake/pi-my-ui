<script lang="ts">
  import type { ImageAttachment, StreamingBehavior, ThinkingLevel } from "@pi-my-ui/protocol";

  import Composer from "./Composer.svelte";
  import ConnectionStatusIndicator from "./ConnectionStatusIndicator.svelte";
  import RunStateRow from "./RunStateRow.svelte";
  import SessionDrawer from "./SessionDrawer.svelte";
  import SessionStatsPanel from "./SessionStatsPanel.svelte";
  import Transcript from "./Transcript.svelte";
  import { BuiltinCommand, notImplementedMessage } from "./commands/builtins.js";
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
    onSetSessionName = () => undefined,
    onGetSessionStats = () => undefined,
    onExportSession = () => undefined,
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
    onSetSessionName?: (name: string) => void;
    onGetSessionStats?: () => void;
    onExportSession?: () => void;
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

  /** The active Session's name as the drawer has it; a Session with none is named honestly. */
  function currentSessionName(): string {
    const active = store.sessions.activeSessionId;
    const row = store.sessions.rows?.find((candidate) => candidate.summary.id === active);
    const name = row?.summary.name?.trim();
    return name === undefined || name === "" ? "unnamed" : name;
  }

  /**
   * The single action of each built-in that lives outside the composer. The two status controls
   * never arrive here: the composer consumes them with its own pickers. A built-in whose action has
   * not landed yet reports that rather than appearing to have run.
   */
  function runBuiltin(command: BuiltinCommand, args: string): void {
    switch (command) {
      case BuiltinCommand.New:
        onCreateSession();
        return;
      case BuiltinCommand.Resume:
        sessionsOpen = true;
        return;
      case BuiltinCommand.Name:
        if (args === "") {
          store.commands.setNotice(`Current session name: ${currentSessionName()}`);
          return;
        }
        onSetSessionName(args);
        return;
      case BuiltinCommand.Session:
        onGetSessionStats();
        return;
      case BuiltinCommand.Export:
        onExportSession();
        return;
      case BuiltinCommand.Tree:
      case BuiltinCommand.Compact:
      case BuiltinCommand.Fork:
      case BuiltinCommand.Clone:
        store.commands.setNotice(notImplementedMessage(command));
        return;
      default:
        return;
    }
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
  {#if store.commands.notice !== null || store.commands.stats !== null || store.commands.exportedPath !== null}
    <section
      class="border-t border-neutral-800 px-3 py-2 text-xs"
      aria-label="Command result"
      data-testid="command-result"
    >
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          {#if store.commands.notice !== null}
            <p class="text-neutral-300" data-testid="command-notice">{store.commands.notice}</p>
          {/if}
          {#if store.commands.stats !== null}
            <SessionStatsPanel stats={store.commands.stats} />
          {/if}
          {#if store.commands.exportedPath !== null}
            <p class="text-neutral-400" data-testid="session-export-path">
              {store.commands.exportedPath}
            </p>
            <button
              type="button"
              class="mt-1 min-h-11 rounded border border-neutral-700 px-3"
              data-testid="session-export-download"
              onclick={() => {
                onDownloadFile(store.commands.exportedPath ?? "");
              }}
            >
              Download
            </button>
          {/if}
        </div>
        <button
          type="button"
          class="grid size-11 shrink-0 place-items-center text-neutral-400"
          aria-label="Dismiss command result"
          data-testid="command-result-dismiss"
          onclick={() => {
            store.commands.dismissResults();
          }}
        >
          ×
        </button>
      </div>
    </section>
  {/if}
  <Composer
    runState={store.transcript.runState}
    {status}
    settings={store.settings.settings}
    commands={store.commands.discoverable}
    error={store.composer.error}
    sentCount={store.composer.sentCount}
    onPrompt={handlePrompt}
    {onAbort}
    onCommand={runBuiltin}
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
