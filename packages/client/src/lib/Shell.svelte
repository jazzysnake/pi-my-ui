<script lang="ts">
  import type { ImageAttachment, StreamingBehavior, ThinkingLevel } from "@pi-my-ui/protocol";

  import Composer from "./Composer.svelte";
  import AgentList from "./AgentList.svelte";
  import ForkPicker from "./ForkPicker.svelte";
  import MessageTreeModal from "./MessageTreeModal.svelte";
  import RunStateRow from "./RunStateRow.svelte";
  import SessionDrawer from "./SessionDrawer.svelte";
  import SessionStatsPanel from "./SessionStatsPanel.svelte";
  import TopBar from "./TopBar.svelte";
  import Transcript from "./Transcript.svelte";
  import { BuiltinCommand } from "./commands/builtins.js";
  import FileTreePanel from "./files/FileTreePanel.svelte";
  import { ROOT_PATH } from "./files/rows.js";
  import type { ClientStore } from "./store/client-store.svelte.js";
  import { sessionDisplayName } from "./store/sessions.svelte.js";
  import { isSteerable, steerTargetOf } from "./subagents/steering.js";
  import type { ConnectionStatus } from "./transport.js";

  let {
    store,
    status,
    onSelectSession,
    onPrompt,
    onBash,
    onAbort,
    onSetModel = () => undefined,
    onSetThinkingLevel = () => undefined,
    onSetAutoCompaction = () => undefined,
    onCompact = () => undefined,
    onSetSessionName = () => undefined,
    onGetSessionStats = () => undefined,
    onExportSession = () => undefined,
    onGetForkMessages = () => undefined,
    onFork = () => undefined,
    onClone = () => undefined,
    onGetTree = () => undefined,
    onMoveLeaf = () => undefined,
    onListDirectory,
    onPreviewFile,
    onDownloadFile,
    onCreateSession = () => undefined,
    onReconnect = () => undefined,
    onSteerSubagent = () => undefined,
    onGetSubagentTranscript = () => undefined,
    startWithSessionsOpen = false,
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
    onBash: (command: string, excludeFromContext: boolean) => void;
    onSetModel?: (provider: string, modelId: string) => void;
    onSetThinkingLevel?: (level: ThinkingLevel) => void;
    onSetAutoCompaction?: (enabled: boolean) => void;
    onCompact?: (customInstructions?: string) => void;
    onSetSessionName?: (name: string) => void;
    onGetSessionStats?: () => void;
    onExportSession?: () => void;
    onGetForkMessages?: () => void;
    onFork?: (entryId: string) => void;
    onClone?: () => void;
    onGetTree?: () => void;
    onMoveLeaf?: (entryId: string) => void;
    onListDirectory: (path: string) => void;
    onPreviewFile: (path: string) => void;
    onDownloadFile: (path: string) => void;
    onCreateSession?: () => void;
    onReconnect?: () => void;
    /** Steer one running subagent; a typed message while its conversation is shown. */
    onSteerSubagent?: (agentId: string, message: string) => void;
    /** Read one settled run's own conversation from the session file pi-subagents wrote. */
    onGetSubagentTranscript?: (agentId: string) => void;
    /** A page opened without a Session shows the list instead of an empty transcript. */
    startWithSessionsOpen?: boolean;
  } = $props();

  let filesOpen = $state(false);
  let sessionsOpen = $state(false);
  let forkOpen = $state(false);
  let agentsOpen = $state(false);
  /** The composer's draft, so the message tree can hand one of the user's messages back to it. */
  let composerText = $state("");
  /** The exported path already handed to the browser, so a re-render does not download twice. */
  let downloadedExport = $state<string | null>(null);

  /**
   * The rows the transcript draws: the Session's own conversation, or the focused agent's. Both are
   * the same view fed a different Projection slice, so reading either one works the same way.
   */
  const shownEntries = $derived(
    store.subagents.focusedAgentId === null
      ? store.transcript.entries
      : store.subagents.transcriptOf(store.subagents.focusedAgentId),
  );

  /**
   * Whether a Session is open: one selected by the reader, or one whose Projection has arrived.
   * The second half covers a page opened straight at `?session=`, where the selection and the first
   * Snapshot race.
   */
  const sessionOpen = $derived(
    store.sessions.activeSessionId !== null || store.transcript.sessionId !== null,
  );

  /** The sentence for an agent whose transcript is empty, so an empty view is never unexplained. */
  const shownEmpty = $derived(
    store.subagents.focusedAgentId === null
      ? sessionOpen
        ? null
        : "No session open. Pick one from the Sessions list, or start a new one."
      : (store.subagents.emptyStateOf(store.subagents.focusedAgentId)?.message ?? null),
  );

  /**
   * A page opened with no Session named shows the list rather than an empty transcript. The page
   * decides this from its address; the drawer otherwise stays collapsed so the transcript gets the
   * screen.
   */
  $effect(() => {
    if (startWithSessionsOpen && !sessionOpen && store.sessions.rows !== null) {
      sessionsOpen = true;
    }
  });

  // Focusing an agent is what asks for its conversation on disk, and the ask is repeated after a
  // resync drops the answer: both are facts the store holds, so the effect follows them rather than
  // the click that caused them.
  $effect(() => {
    const agentId = store.subagents.focusedAgentId;
    if (agentId === null) {
      return;
    }
    // Reading the roster makes a newly reported agent a reason to look again.
    void store.subagents.agents;
    if (store.subagents.requestPastTranscript(agentId)) {
      onGetSubagentTranscript(agentId);
    }
  });

  /**
   * The agent a typed message would steer. While an agent's conversation is shown, plain text is
   * addressed to that agent, so the composer must know whether it can reach it and why not.
   */
  const steerTarget = $derived(
    steerTargetOf(store.subagents.agents, store.subagents.focusedAgentId),
  );

  // A confirmed Leaf move on one of the user's own messages returns its text here, which is what
  // makes it editable and resubmittable instead of merely read.
  $effect(() => {
    const draft = store.tree.draft;
    if (draft !== null) {
      composerText = draft.text;
    }
  });

  /**
   * The one way into the message tree: the typed command and the composer's branch control both land
   * here, so two entrances cannot drift into two modals or two different requests.
   */
  function openTree(): void {
    store.tree.begin();
    onGetTree();
  }

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

  // `/export` is one action: pi writes the HTML and the browser starts the download as soon as the
  // server names the file. The path stays visible as the record of what was written.
  $effect(() => {
    const path = store.commands.exportedPath;
    if (path === null) {
      downloadedExport = null;
      return;
    }
    if (path !== downloadedExport) {
      downloadedExport = path;
      onDownloadFile(path);
    }
  });

  /**
   * The respawn the transcript's crash row offers. The store records the wait before the transport is
   * asked, so the row reads Starting… from the click and falls back to the crash if the ask fails.
   */
  function handleReconnect(): void {
    store.transcript.requestReconnect();
    onReconnect();
  }

  /**
   * A steer is recorded before it is sent, so its status line appears from the click; the store
   * clears it when pi delivers the message, refuses it, or ends the run without delivering it.
   */
  function handleSteer(agentId: string, message: string): void {
    const agent = store.subagents.agents.find((candidate) => candidate.id === agentId);
    if (agent === undefined || !isSteerable(agent.status)) {
      return;
    }
    store.subagents.noteSteer(agentId);
    onSteerSubagent(agentId, message);
  }

  /** The active Session's name, using the same rule the drawer renders it with. */
  function currentSessionName(): string {
    const active = store.sessions.activeSessionId;
    const row = store.sessions.rows?.find((candidate) => candidate.summary.id === active);
    return row === undefined || active === null ? "unnamed" : sessionDisplayName(row.summary);
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
      case BuiltinCommand.Compact:
        // pi compacts asynchronously and reports the boundary on its own stream, so this asks and
        // nothing here reports success.
        onCompact(args === "" ? undefined : args);
        return;
      case BuiltinCommand.Fork:
        // pi owns the list of messages a fork can start from, so the picker opens empty and fills
        // from pi's answer rather than from what this client happens to hold.
        store.commands.beginForkPicker();
        forkOpen = true;
        onGetForkMessages();
        return;
      case BuiltinCommand.Clone:
        onClone();
        return;
      case BuiltinCommand.Tree:
        openTree();
        return;
      default:
        return;
    }
  }
</script>

<div
  class="relative flex h-dvh flex-col overflow-hidden bg-canvas text-ink"
  data-testid="app-shell"
  data-session-id={store.sessions.activeSessionId ?? undefined}
>
  <TopBar
    {store}
    {status}
    onToggleSessions={() => {
      sessionsOpen = !sessionsOpen;
    }}
    onToggleFiles={() => {
      filesOpen = !filesOpen;
      if (filesOpen) {
        onListDirectory(ROOT_PATH);
      }
    }}
    onOpenAgents={() => {
      agentsOpen = true;
    }}
  />
  <Transcript
    entries={shownEntries}
    empty={shownEmpty}
    snapshotCount={store.transcript.snapshotCount}
  />
  <RunStateRow
    runState={store.transcript.runState}
    starting={store.transcript.starting}
    onReconnect={handleReconnect}
  />
  {#if store.commands.notice !== null || store.commands.stats !== null || store.commands.exportedPath !== null}
    <section
      class="border-t border-hairline px-3 py-2 text-meta"
      aria-label="Command result"
      data-testid="command-result"
    >
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          {#if store.commands.notice !== null}
            <p class="text-dim" data-testid="command-notice">{store.commands.notice}</p>
          {/if}
          {#if store.commands.stats !== null}
            <SessionStatsPanel stats={store.commands.stats} />
          {/if}
          {#if store.commands.exportedPath !== null}
            <p class="text-dim" data-testid="session-export-path">
              {store.commands.exportedPath}
            </p>
          {/if}
        </div>
        <button
          type="button"
          class="grid size-11 shrink-0 place-items-center text-dim"
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
    {onBash}
    {onAbort}
    onCommand={runBuiltin}
    {onSetModel}
    {onSetThinkingLevel}
    {onSetAutoCompaction}
    onBranch={openTree}
    {steerTarget}
    steerInFlight={store.subagents.steerInFlight}
    onSteer={handleSteer}
    sessionActive={sessionOpen}
    bind:text={composerText}
  />
  {#if forkOpen}
    <ForkPicker
      messages={store.commands.forkMessages}
      onChoose={(entryId) => {
        forkOpen = false;
        onFork(entryId);
      }}
      onClose={() => {
        forkOpen = false;
      }}
    />
  {/if}
  {#if store.tree.open}
    <MessageTreeModal
      tree={store.tree.tree}
      loading={store.tree.loading}
      error={store.tree.error}
      moveError={store.tree.moveError}
      movingEntryId={store.tree.movingEntryId}
      onSelect={(entry) => {
        store.tree.select(entry);
        onMoveLeaf(entry.entry.id);
      }}
      onClose={() => {
        store.tree.close();
      }}
    />
  {/if}
  {#if agentsOpen}
    <AgentList
      {store}
      onSelect={(agentId) => {
        store.subagents.focus(agentId);
        agentsOpen = false;
      }}
      onClose={() => {
        agentsOpen = false;
      }}
    />
  {/if}
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
