<script lang="ts">
  import Shell from "./lib/Shell.svelte";
  import { projectAddress, resolveClientConfig } from "./lib/config.js";
  import { fileDownloadUrl, startFileDownload } from "./lib/files/download.js";
  import { createDeviceProjectStorage } from "./lib/projects/storage.js";
  import { ClientStore } from "./lib/store/client-store.svelte.js";
  import { ConnectionStatus, createTransport, type Transport } from "./lib/transport.js";

  const config = resolveClientConfig(window.location.href, window.location.search);
  const store = new ClientStore(config.project, createDeviceProjectStorage());
  let status = $state<ConnectionStatus>(ConnectionStatus.Connecting);
  let transport = $state<Transport | null>(null);

  /** Keep the address copyable: a Project choice lands there, and a Session choice names both. */
  function writeAddress(project: string, sessionId: string | null): void {
    const address = projectAddress(window.location.href, project, sessionId, config.wsOverride);
    window.history.replaceState(null, "", address);
  }

  $effect(() => {
    const created = createTransport({
      url: config.wsUrl,
      sessionId: config.sessionId,
      handlers: {
        onStatus(next) {
          status = next;
        },
        onMessage(message) {
          store.receive(message);
        },
        onSessionOpened(session) {
          store.selectSession(session);
        },
      },
    });
    transport = created;
    created.start();
    return () => {
      created.stop();
      transport = null;
    };
  });

  // The store owns the decision; the transport only watches what it chose. A Project switch clears
  // the Session, and the address follows both so a copy of the URL lands in the same place.
  $effect(() => {
    const project = store.projects.chosen;
    const sessionId = store.sessions.activeSessionId;
    if (project === null) {
      return;
    }
    transport?.switchProject(project);
    writeAddress(project, sessionId);
  });
</script>

<Shell
  {store}
  {status}
  startWithSessionsOpen={config.sessionId === null}
  onSelectProject={(project) => store.selectProject(project)}
  onSelectSession={(sessionId) => {
    const project = store.projects.chosen;
    if (project === null) {
      return;
    }
    const session = { project, id: sessionId };
    store.selectSession(session);
    transport?.switchSession(session);
  }}
  onCreateSession={() => transport?.createSession()}
  onCreateProject={(name) => transport?.createProject(name)}
  onPrompt={(text, images, behavior) => transport?.prompt(text, images, behavior)}
  onBash={(command, excludeFromContext) => transport?.bash(command, excludeFromContext)}
  onSteerSubagent={(agentId, message) => transport?.steerSubagent(agentId, message)}
  onGetSubagentTranscript={(agentId) => transport?.getSubagentTranscript(agentId)}
  onAbort={() => transport?.abort()}
  onSetModel={(provider, modelId) => transport?.setModel(provider, modelId)}
  onSetThinkingLevel={(level) => transport?.setThinkingLevel(level)}
  onSetAutoCompaction={(enabled) => transport?.setAutoCompaction(enabled)}
  onCompact={(customInstructions) => transport?.compact(customInstructions)}
  onSetSessionName={(name) => transport?.setSessionName(name)}
  onGetSessionStats={() => transport?.getSessionStats()}
  onExportSession={() => transport?.exportSession()}
  onGetForkMessages={() => transport?.getForkMessages()}
  onFork={(entryId) => transport?.forkSession(entryId)}
  onClone={() => transport?.cloneSession()}
  onReconnect={() => transport?.reconnect()}
  onReload={() => transport?.reload()}
  onGetTree={() => transport?.getTree()}
  onMoveLeaf={(entryId) => transport?.moveLeaf(entryId)}
  onListDirectory={(project, path) => transport?.listDirectory(project, path)}
  onPreviewFile={(project, path) => transport?.previewFile(project, path)}
  onDownloadFile={(project, path) =>
    startFileDownload(fileDownloadUrl(config.wsUrl, project, path))}
/>
