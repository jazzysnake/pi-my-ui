<script lang="ts">
  /**
   * The first screen when no Project is chosen: every served Project, one tap each. A linked or
   * remembered path the server does not serve is stated here in the warning tone rather than as an
   * error, because nothing failed — the server simply serves a different list now.
   */
  import Icon from "./Icon.svelte";
  import { projectLabels } from "./projects/labels.js";

  let {
    projects,
    warning,
    onChoose,
  }: {
    projects: readonly string[];
    warning: string | null;
    onChoose: (project: string) => void;
  } = $props();

  const labels = $derived(projectLabels(projects));
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
    <p class="border-b border-hairline px-4 py-3 text-body text-warning" data-testid="project-warning">
      {warning}
    </p>
  {/if}

  <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Project list">
    <ul data-testid="project-list">
      {#each projects as project (project)}
        <li class="border-b border-hairline">
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left"
            data-testid="project-row"
            data-project={project}
            onclick={() => onChoose(project)}
          >
            <Icon name="folder" class="size-4 shrink-0 text-dim" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body" data-testid="project-label"
                >{labels.get(project) ?? project}</span
              >
              <span class="block truncate text-meta text-faint" data-testid="project-path"
                >{project}</span
              >
            </span>
            <Icon name="chevron-right" class="size-4 shrink-0 text-dim" />
          </button>
        </li>
      {/each}
    </ul>
  </nav>
</div>
