<script lang="ts">
  import Shell from "./lib/Shell.svelte";
  import { resolveClientConfig } from "./lib/config.js";
  import { ClientStore } from "./lib/store/client-store.svelte.js";
  import { ConnectionStatus, createTransport } from "./lib/transport.js";

  const store = new ClientStore();
  let status = $state<ConnectionStatus>(ConnectionStatus.Connecting);

  $effect(() => {
    const config = resolveClientConfig(window.location.href, window.location.search);
    if (config.sessionId === null) {
      return;
    }
    const transport = createTransport({
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
    transport.start();
    return () => {
      transport.stop();
    };
  });
</script>

<Shell {store} {status} />
