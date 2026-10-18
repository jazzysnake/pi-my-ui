<script lang="ts">
  /**
   * The Session drawer: Projects, then the chosen Project's Sessions. The Project switcher stays
   * reachable from the Sessions level, so changing Projects is one tap from the list and never a
   * reload. Each Session row shows the display name and the time since its file last changed, and
   * the whole row is the tap target that switches the view. pi owns the files: no rename or delete
   * control exists.
   */
  import type { SessionRow } from "./store/sessions.svelte.js";

  import Icon from "./Icon.svelte";
  import { projectLabels } from "./projects/labels.js";
  import { RELATIVE_TIME_REFRESH_MS, formatRelativeTime } from "./sessions/relative-time.js";
  import { sessionDisplayName } from "./store/sessions.svelte.js";

  let {
    rows,
    projects,
    chosenProject,
    activeSessionId,
    onSelect,
    onSelectProject,
    onCreateSession,
    onClose,
  }: {
    rows: readonly SessionRow[] | null;
    projects: readonly string[] | null;
    chosenProject: string | null;
    activeSessionId: string | null;
    onSelect: (sessionId: string) => void;
    onSelectProject: (project: string) => void;
    onCreateSession: () => void;
    onClose: () => void;
  } = $props();

  let level = $state<"sessions" | "projects">("sessions");
  let nowMs = $state(Date.now());

  const served = $derived(
    projects !== null && projects.length > 0
      ? projects
      : chosenProject === null
        ? []
        : [chosenProject],
  );
  const labels = $derived(projectLabels(served));
  const currentLabel = $derived(
    chosenProject === null ? "" : (labels.get(chosenProject) ?? chosenProject),
  );

  // Refresh the labels while the drawer is open, so a visible minute does not go stale without a reload.
  $effect(() => {
    nowMs = Date.now();
    const handle = window.setInterval(() => {
      nowMs = Date.now();
    }, RELATIVE_TIME_REFRESH_MS);
    return () => {
      window.clearInterval(handle);
    };
  });

  function chooseProject(project: string): void {
    onSelectProject(project);
    level = "sessions";
  }
</script>

<div class="absolute inset-0 z-20 flex">
  <aside
    class="flex w-72 max-w-[80%] flex-col border-r border-hairline-strong bg-panel"
    aria-label={level === "projects" ? "Projects" : "Sessions"}
    data-testid="session-drawer"
    data-level={level}
  >
    {#if level === "projects"}
      <div class="flex items-center gap-1 border-b border-hairline px-3 py-2">
        <button
          type="button"
          class="grid size-11 shrink-0 place-items-center text-dim"
          aria-label="Back to sessions"
          data-testid="project-back"
          onclick={() => {
            level = "sessions";
          }}
        >
          <Icon name="chevron-right" class="size-4 rotate-180" />
        </button>
        <span class="text-meta tracking-wider text-dim uppercase">Projects</span>
      </div>
    {:else}
      <div class="flex items-center gap-1 border-b border-hairline px-3 py-2">
        <span class="min-w-0 flex-1">
          <span class="block text-meta tracking-wider text-dim uppercase">Sessions</span>
          <span
            class="block truncate text-body text-ink"
            data-testid="current-project-label">{currentLabel}</span
          >
        </span>
        <button
          type="button"
          class="min-h-11 shrink-0 rounded px-2 text-meta text-accent"
          aria-label="Switch Project"
          data-testid="project-switch"
          onclick={() => {
            level = "projects";
          }}
        >
          Switch
        </button>
        <button
          type="button"
          class="grid size-11 shrink-0 place-items-center rounded text-body text-dim"
          aria-label="New session"
          data-testid="new-session-action"
          onclick={() => onCreateSession()}
        >
          <Icon name="plus" />
        </button>
      </div>
    {/if}

    {#if level === "projects"}
      <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Project list">
        <ul data-testid="project-list">
          {#each served as project (project)}
            {@const isCurrent = project === chosenProject}
            <li class="border-b border-hairline">
              <button
                type="button"
                class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
                class:bg-panel-raised={isCurrent}
                data-testid="project-row"
                data-project={project}
                data-current={isCurrent ? "true" : "false"}
                aria-current={isCurrent ? "true" : undefined}
                onclick={() => chooseProject(project)}
              >
                <Icon name="folder" class="size-4 shrink-0 text-dim" />
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-body"
                    class:text-ink={isCurrent}
                    class:text-dim={!isCurrent}
                    data-testid="project-label">{labels.get(project) ?? project}</span
                  >
                  <span class="block truncate text-meta text-faint" data-testid="project-path"
                    >{project}</span
                  >
                </span>
                {#if isCurrent}
                  <Icon name="check" class="size-4 shrink-0 text-success" />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </nav>
    {:else}
      <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Session list">
        {#if rows === null}
          <p class="px-3 py-4 text-dim" data-testid="session-list-loading">Loading…</p>
        {:else if rows.length === 0}
          <p class="px-3 py-4 text-dim" data-testid="session-list-empty">No sessions yet.</p>
        {:else}
          <ul data-testid="session-list">
            {#each rows as row (row.summary.id)}
              {@const isCurrent = row.summary.id === activeSessionId}
              <li class="border-b border-hairline">
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center px-3 py-2 text-left"
                  class:bg-panel-raised={isCurrent}
                  data-testid="session-row"
                  data-session-id={row.summary.id}
                  data-activity={row.working ? "working" : "idle"}
                  aria-current={isCurrent ? "true" : undefined}
                  onclick={() => onSelect(row.summary.id)}
                >
                  <span class="min-w-0 flex-1">
                    <span
                      class="block truncate text-body"
                      class:text-ink={isCurrent}
                      class:text-dim={!isCurrent}
                      data-testid="session-name">{sessionDisplayName(row.summary)}</span
                    >
                    <span class="block truncate text-meta text-faint" data-testid="session-time"
                      >{formatRelativeTime(row.summary.lastActivityAt, nowMs)}</span
                    >
                  </span>
                  {#if row.working || row.unread}
                    <span
                      class="ml-2 h-2 w-2 shrink-0 rounded-full"
                      class:bg-warning={row.working}
                      class:bg-accent={!row.working && row.unread}
                      data-testid="activity-dot"
                      data-activity-kind={row.working ? "working" : "unread"}
                      aria-label={row.working ? "Working" : "Unread output"}
                    ></span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </nav>
    {/if}
  </aside>

  <button
    type="button"
    class="flex-1 bg-scrim"
    aria-label="Close sessions sidebar"
    onclick={onClose}
  ></button>
</div>
