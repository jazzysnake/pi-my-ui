<script lang="ts">
  let { items }: { items: readonly string[] } = $props();
</script>

<ul>
  {#each items as item (item)}
    <li>{item}</li>
  {/each}
</ul>
