/**
 * The Projects slice: the served paths in the order the server was given them, and the one the
 * browser is looking at. It is the one owner of that choice, so the drawer, the transport and the
 * files panel cannot disagree about which Project is current.
 *
 * A linked Project the registry does not serve selects nothing; with no chosen Project there is no
 * Project's Session list to show.
 */

import { ServerMessageType, type ServerMessage } from "@pi-my-ui/protocol";

export interface ProjectsSlice {
  /** The served Projects, or `null` until the server answers. */
  readonly projects: readonly string[] | null;
  /** The Project the browser is looking at, or `null` when none could be chosen. */
  readonly chosen: string | null;
  receive(message: ServerMessage): void;
  /** Choose a served Project; a path outside the registry selects nothing. */
  select(project: string): void;
  clear(): void;
}

export function createProjectsSlice(linkedProject: string | null = null): ProjectsSlice {
  let projects = $state<readonly string[] | null>(null);
  let chosen = $state<string | null>(null);

  function chooseFrom(served: readonly string[]): string | null {
    if (linkedProject !== null) {
      return served.includes(linkedProject) ? linkedProject : null;
    }
    return served[0] ?? null;
  }

  return {
    get projects() {
      return projects;
    },
    get chosen() {
      return chosen;
    },
    receive(message) {
      if (message.type === ServerMessageType.Projects) {
        projects = message.projects;
        if (chosen === null) {
          chosen = chooseFrom(message.projects);
        }
        return;
      }
      // A Sessions answer is only ever for the chosen Project's list, so its name confirms the
      // choice when the Projects answer has already been applied.
      if (message.type === ServerMessageType.Sessions && chosen === null) {
        chosen = message.project;
      }
    },
    select(project) {
      if (projects === null || !projects.includes(project)) {
        return;
      }
      chosen = project;
    },
    clear() {
      chosen = null;
    },
  };
}
