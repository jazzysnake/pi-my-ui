<script lang="ts">
  import Shell from "./lib/Shell.svelte";
  import { resolveClientConfig } from "./lib/config.js";
  import { fileDownloadUrl, startFileDownload } from "./lib/files/download.js";
  import { ClientStore } from "./lib/store/client-store.svelte.js";
  import { ConnectionStatus, createTransport, type Transport } from "./lib/transport.js";

  const store = new ClientStore();
  const config = resolveClientConfig(window.location.href, window.location.search);
  let status = $state<ConnectionStatus>(ConnectionStatus.Connecting);
  let transport = $state<Transport | null>(null);

  $effect(() => {
    if (config.sessionId !== null) {
      store.selectSession(config.sessionId);
    }
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
        onSessionOpened(sessionId) {
          store.selectSession(sessionId);
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
</script>

<Shell
  {store}
  {status}
  startWithSessionsOpen={config.sessionId === null}
  onSelectSession={(sessionId) => {
    store.selectSession(sessionId);
    transport?.switchSession(sessionId);
  }}
  onCreateSession={() => transport?.createSession()}
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
  onGetTree={() => transport?.getTree()}
  onMoveLeaf={(entryId) => transport?.moveLeaf(entryId)}
  onListDirectory={(path) => transport?.listDirectory(path)}
  onPreviewFile={(path) => transport?.previewFile(path)}
  onDownloadFile={(path) => startFileDownload(fileDownloadUrl(config.wsUrl, path))}
/>
