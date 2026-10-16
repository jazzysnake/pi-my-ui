<script lang="ts">
  import PlaceholderList from "./lib/PlaceholderList.svelte";

  const placeholder = ["client shell"];
</script>

<main class="min-h-dvh bg-neutral-950 p-4 text-neutral-100">
  <h1 class="text-lg font-semibold">pi-my-ui</h1>
  <PlaceholderList items={placeholder} />
</main>
