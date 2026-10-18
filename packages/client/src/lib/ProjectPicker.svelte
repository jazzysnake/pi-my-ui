<script lang="ts">
  /**
   * The first screen when no Project is chosen: every served Project, one tap each. A linked or
   * remembered path the server does not serve is stated here in the warning tone rather than as an
   * error, because nothing failed — the server simply serves a different list now.
   */
  import ProjectRow from "./ProjectRow.svelte";
  import { projectLabeler } from "./projects/labels.js";

  let {
    projects,
    warning,
    onChoose,
  }: {
    projects: readonly string[];
    warning: string | null;
    onChoose: (project: string) => void;
  } = $props();

  const labelOf = $derived(projectLabeler(projects));
</script>

<div
  class="absolute inset-0 z-40 flex flex-col bg-canvas text-ink"
  aria-label="Choose a Project"
  data-testid="project-picker"
>
  <header class="border-b border-hairline px-4 py-3">
    <span class="text-meta tracking-wider text-dim uppercase">Projects</span>
    <h1 class="text-body font-semibold">Choose a Project</h1>
  </header>

  {#if warning !== null}
    <p
      class="border-b border-hairline px-4 py-3 text-body text-warning"
      data-testid="project-warning"
    >
      {warning}
    </p>
  {/if}

  <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Project list">
    <ul data-testid="project-list">
      {#each projects as project (project)}
        <ProjectRow {project} label={labelOf(project)} current={false} {onChoose} />
      {/each}
    </ul>
  </nav>
</div>
