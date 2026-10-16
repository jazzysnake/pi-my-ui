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
    if (config.sessionId === null) {
      return;
    }
    store.selectSession(config.sessionId);
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
  onSelectSession={(sessionId) => {
    store.selectSession(sessionId);
    transport?.switchSession(sessionId);
  }}
  onPrompt={(text) => transport?.prompt(text)}
  onAbort={() => transport?.abort()}
  onListDirectory={(path) => transport?.listDirectory(path)}
  onPreviewFile={(path) => transport?.previewFile(path)}
  onDownloadFile={(path) => startFileDownload(fileDownloadUrl(config.wsUrl, path))}
/>
