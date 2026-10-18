/**
 * The Projects slice: the served paths in the order the server was given them, and the one the
 * browser is looking at. It is the one owner of that choice, so the drawer, the transport and the
 * files panel cannot disagree about which Project is current.
 *
 * A linked or remembered Project the registry does not serve selects nothing and says which path was
 * missing; nothing has failed, so that notice is a warning rather than an error. With nothing linked
 * or remembered, one served Project selects itself and several leave the choice to the picker.
 */

import { ServerMessageType, type ServerMessage } from "@pi-my-ui/protocol";

import {
  createNoopProjectStorage,
  type ProjectStorage,
} from "../projects/storage.js";

export interface ProjectsSlice {
  /** The served Projects, or `null` until the server answers. */
  readonly projects: readonly string[] | null;
  /** The Project the browser is looking at, or `null` when none could be chosen. */
  readonly chosen: string | null;
  /** Why the picker is showing instead of a remembered or linked Project, or `null`. */
  readonly warning: string | null;
  receive(message: ServerMessage): void;
  /** Choose a served Project; a path outside the registry selects nothing. */
  select(project: string): void;
  clear(): void;
}

export function createProjectsSlice(
  linkedProject: string | null = null,
  storage: ProjectStorage = createNoopProjectStorage(),
): ProjectsSlice {
  let projects = $state<readonly string[] | null>(null);
  let chosen = $state<string | null>(null);
  let warning = $state<string | null>(null);

  function choose(project: string): void {
    chosen = project;
    warning = null;
    storage.write(project);
  }

  function decideFrom(served: readonly string[]): void {
    if (linkedProject !== null) {
      if (served.includes(linkedProject)) {
        choose(linkedProject);
      } else {
        warning = `This server does not serve ${linkedProject}. Choose a Project below.`;
      }
      return;
    }

    const remembered = storage.read();
    if (remembered !== null) {
      if (served.includes(remembered)) {
        choose(remembered);
      } else {
        warning = `This server no longer serves ${remembered}. Choose a Project below.`;
      }
      return;
    }

    if (served.length === 1) {
      const only = served[0];
      if (only !== undefined) {
        choose(only);
      }
    }
  }

  return {
    get projects() {
      return projects;
    },
    get chosen() {
      return chosen;
    },
    get warning() {
      return warning;
    },
    receive(message) {
      if (message.type !== ServerMessageType.Projects) {
        return;
      }
      projects = message.projects;
      if (chosen === null) {
        decideFrom(message.projects);
      }
    },
    select(project) {
      if (projects === null || !projects.includes(project)) {
        return;
      }
      choose(project);
    },
    clear() {
      chosen = null;
    },
  };
}
