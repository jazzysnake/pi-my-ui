/**
 * The Projects slice: the served paths in the order the server was given them, the Workspace they
 * live in, and the one the browser is looking at. It is the one owner of that choice, so the drawer,
 * the transport and the files panel cannot disagree about which Project is current.
 *
 * A linked or remembered Project the registry does not serve selects nothing and says which path was
 * missing; nothing has failed, so that notice is a warning rather than an error. With nothing linked
 * or remembered, one served Project selects itself and several leave the choice to the picker.
 *
 * Creating a Project is a request the server can refuse, so the refusal is held here in the reader's
 * words rather than the server's: the name sheet renders that one line and keeps what was typed.
 */

import { ProtocolErrorCode, ServerMessageType, type ServerMessage } from "@pi-my-ui/protocol";

import { createNoopProjectStorage, type ProjectStorage } from "../projects/storage.js";

export interface ProjectsSlice {
  /** The served Projects, or `null` until the server answers. */
  readonly projects: readonly string[] | null;
  /** The directory the server anchors new Projects to, or `null` without one. */
  readonly workspace: string | null;
  /** Whether a created name has a Workspace to be joined to, which is the whole permission. */
  readonly canCreate: boolean;
  /** The Project the browser is looking at, or `null` when none could be chosen. */
  readonly chosen: string | null;
  /** Why the picker is showing instead of a remembered or linked Project, or `null`. */
  readonly warning: string | null;
  /** True between asking for a Project and the server's answer to that ask. */
  readonly creating: boolean;
  /** The server's refusal of the last create, in words a reader uses, or `null`. */
  readonly createError: string | null;
  /** The path the last create registered, which is what closes the name sheet. */
  readonly createdProject: string | null;
  receive(message: ServerMessage): void;
  /** Choose a served Project; a path outside the registry selects nothing. */
  select(project: string): void;
  clear(): void;
  /** Record the ask before the transport is asked, so a refusal has somewhere to land. */
  requestCreate(): void;
  /** Forget the last create; the name sheet opening or closing calls it. */
  resetCreate(): void;
}

/**
 * A refusal as a sentence on a phone: the code is the server's vocabulary, and the message it carries
 * is written for a log. Nothing here names a code, dumps JSON or calls a name rule an internal error.
 */
function refusalOf(code: ProtocolErrorCode): string {
  switch (code) {
    case ProtocolErrorCode.NoWorkspace:
      return "This server has no Workspace, so there is nowhere to create a Project.";
    case ProtocolErrorCode.InvalidProjectName:
      return "That name cannot be a Project. Use one name, with no slashes and no leading dot, and one that is not already a file or a link.";
    case ProtocolErrorCode.ProjectExists:
      return "A Project with that name is already served. Try another name.";
    default:
      return "The server could not create that Project. Try again.";
  }
}

export function createProjectsSlice(
  linkedProject: string | null = null,
  storage: ProjectStorage = createNoopProjectStorage(),
): ProjectsSlice {
  let projects = $state<readonly string[] | null>(null);
  let workspace = $state<string | null>(null);
  let chosen = $state<string | null>(null);
  let warning = $state<string | null>(null);
  let creating = $state(false);
  let createError = $state<string | null>(null);
  let createdProject = $state<string | null>(null);
  /** The path the next Projects answer should select, so a create is never taken on trust. */
  let pendingSelect: string | null = null;

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

  function receiveProjects(served: readonly string[], root: string | null): void {
    projects = served;
    workspace = root;
    const wanted = pendingSelect;
    pendingSelect = null;
    // The answer is what decides: a created path the server did not list is not a Project it serves,
    // whatever the create said.
    if (wanted !== null && served.includes(wanted)) {
      choose(wanted);
      return;
    }
    // A Project can leave while it is the chosen one — deleted, renamed or its volume unmounted — and
    // the served list is the only news of it. The picker is the answer, as it is for a remembered
    // Project the server does not serve.
    const departing = chosen;
    if (departing !== null && !served.includes(departing)) {
      chosen = null;
      warning = `This server no longer serves ${departing}. Choose a Project below.`;
      return;
    }
    if (chosen === null) {
      decideFrom(served);
    }
  }

  return {
    get projects() {
      return projects;
    },
    get workspace() {
      return workspace;
    },
    get canCreate() {
      return workspace !== null;
    },
    get chosen() {
      return chosen;
    },
    get warning() {
      return warning;
    },
    get creating() {
      return creating;
    },
    get createError() {
      return createError;
    },
    get createdProject() {
      return createdProject;
    },
    receive(message) {
      if (message.type === ServerMessageType.Projects) {
        receiveProjects(message.projects, message.workspace);
        return;
      }
      if (message.type === ServerMessageType.ProjectCreated) {
        creating = false;
        createdProject = message.project;
        pendingSelect = message.project;
        return;
      }
      // Only the ask in flight can explain a refusal shown in the sheet; a failure of anything else
      // must not appear there as if the name were at fault.
      if (message.type === ServerMessageType.Error && creating) {
        creating = false;
        createError = refusalOf(message.error.code);
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
    requestCreate() {
      creating = true;
      createError = null;
    },
    resetCreate() {
      creating = false;
      createError = null;
      createdProject = null;
      pendingSelect = null;
    },
  };
}
