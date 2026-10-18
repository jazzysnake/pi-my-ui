<script lang="ts">
  /**
   * One served Project as a row: the disambiguated label over the absolute path, with the whole row
   * as the tap target. The picker and the drawer's Project level show the same thing, so they show it
   * the same way; only the drawer marks one row as the Project currently chosen.
   */
  import Icon from "./Icon.svelte";

  let {
    project,
    label,
    current,
    onChoose,
  }: {
    project: string;
    label: string;
    current: boolean;
    onChoose: (project: string) => void;
  } = $props();
</script>

<li class="border-b border-hairline">
  <button
    type="button"
    class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
    class:bg-panel-raised={current}
    data-testid="project-row"
    data-project={project}
    data-current={current ? "true" : "false"}
    aria-current={current ? "true" : undefined}
    onclick={() => onChoose(project)}
  >
    <Icon name="folder" class="size-4 shrink-0 text-dim" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-body text-ink" data-testid="project-label">{label}</span>
      <span class="block truncate text-meta text-faint" data-testid="project-path">{project}</span>
    </span>
    {#if current}
      <Icon name="check" class="size-4 shrink-0 text-success" />
    {:else}
      <Icon name="chevron-right" class="size-4 shrink-0 text-dim" />
    {/if}
  </button>
</li>
