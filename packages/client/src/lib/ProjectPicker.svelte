<script lang="ts">
  /**
   * The first screen when no Project is chosen: every served Project, one tap each, and the create
   * control wherever there is a Workspace to create in. A linked or remembered path the server does
   * not serve is stated here in the warning tone rather than as an error, because nothing failed — the
   * server simply serves a different list now.
   */
  import Icon from "./Icon.svelte";
  import ProjectRow from "./ProjectRow.svelte";
  import { projectLabeler } from "./projects/labels.js";

  let {
    projects,
    warning,
    workspace,
    canCreate,
    onOpenCreate,
    onChoose,
  }: {
    projects: readonly string[];
    warning: string | null;
    /** The Workspace new Projects are made in, or `null` when creating is impossible. */
    workspace: string | null;
    /** Whether a create control belongs on this screen at all. */
    canCreate: boolean;
    onOpenCreate: () => void;
    onChoose: (project: string) => void;
  } = $props();

  const labelOf = $derived(projectLabeler(projects));
</script>

<div
  class="absolute inset-0 z-40 flex flex-col bg-canvas text-ink"
  aria-label="Choose a Project"
  data-testid="project-picker"
>
  <header class="flex items-center gap-1 border-b border-hairline px-4 py-3">
    <span class="min-w-0 flex-1">
      <span class="block text-meta tracking-wider text-dim uppercase">Projects</span>
      <h1 class="text-body font-semibold">Choose a Project</h1>
    </span>
    {#if canCreate}
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded text-body text-dim"
        aria-label="New Project"
        data-testid="create-project"
        onclick={onOpenCreate}
      >
        <Icon name="plus" />
      </button>
    {/if}
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
    {#if projects.length === 0}
      <div class="px-4 py-4" data-testid="project-empty">
        <p class="text-body text-ink">This server serves no Projects yet.</p>
        {#if canCreate}
          <p class="mt-1 text-meta text-dim">
            Projects are created inside the Workspace
            <span class="break-all text-faint" data-testid="workspace-path">{workspace}</span>.
          </p>
          <button
            type="button"
            class="mt-3 min-h-11 rounded border border-hairline-strong px-3 text-body text-accent"
            data-testid="create-project-empty"
            onclick={onOpenCreate}
          >
            New Project
          </button>
        {:else}
          <p class="mt-1 text-meta text-dim">
            This server was started without a Workspace, so a Project has to be named on the machine
            running it.
          </p>
        {/if}
      </div>
    {:else}
      <ul data-testid="project-list">
        {#each projects as project (project)}
          <ProjectRow {project} label={labelOf(project)} current={false} {onChoose} />
        {/each}
      </ul>
    {/if}
  </nav>
</div>
