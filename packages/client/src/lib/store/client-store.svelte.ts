/** The client's state, fed by one `ServerMessage` input. Slices by concern plug in here. */

import type { ServerMessage, SessionRef } from "@pi-my-ui/protocol";

import { createComposerSlice, type ComposerSlice } from "./composer.svelte.js";
import { createCommandsSlice, type CommandsSlice } from "./commands.svelte.js";
import { createContextSlice, type ContextSlice } from "./context.svelte.js";
import { createFilesSlice, type FilesSlice } from "./files.svelte.js";
import type { ProjectStorage } from "../projects/storage.js";
import { createProjectsSlice, type ProjectsSlice } from "./projects.svelte.js";
import { createSessionsSlice, type SessionsSlice } from "./sessions.svelte.js";
import { createSettingsSlice, type SettingsSlice } from "./settings.svelte.js";
import { createSubagentsSlice, type SubagentsSlice } from "./subagents.svelte.js";
import { createTranscriptSlice, type TranscriptSlice } from "./transcript.svelte.js";
import { createTreeSlice, type TreeSlice } from "./tree.svelte.js";

export class ClientStore {
  readonly projects: ProjectsSlice;
  readonly transcript: TranscriptSlice = createTranscriptSlice();
  readonly files: FilesSlice = createFilesSlice();
  readonly sessions: SessionsSlice = createSessionsSlice();
  readonly settings: SettingsSlice = createSettingsSlice();
  readonly composer: ComposerSlice = createComposerSlice();
  readonly commands: CommandsSlice = createCommandsSlice();
  readonly subagents: SubagentsSlice = createSubagentsSlice();
  readonly context: ContextSlice = createContextSlice();
  readonly tree: TreeSlice = createTreeSlice();

  constructor(linkedProject: string | null = null, projectStorage?: ProjectStorage) {
    this.projects = createProjectsSlice(linkedProject, projectStorage);
  }

  receive(message: ServerMessage): void {
    this.projects.receive(message);
    this.transcript.receive(message);
    this.files.receive(message);
    this.sessions.receive(message, this.projects.chosen);
    this.settings.receive(message);
    this.composer.receive(message);
    this.commands.receive(message);
    this.subagents.receive(message);
    this.context.receive(message);
    this.tree.receive(message);
  }

  /**
   * Switch the watched Session. The transcript is dropped rather than left to be replaced when the
   * new Snapshot arrives, so the previous Session is never drawn under the new one's name.
   */
  selectSession(session: SessionRef): void {
    this.projects.select(session.project);
    this.sessions.select(session.id);
    this.transcript.clear();
    this.settings.clear();
    this.composer.clearError();
    this.commands.clear();
    this.subagents.clear();
    this.context.clear();
    this.tree.clear();
  }

  /**
   * Switch the watched Project. Its Session list is asked for again, and nothing from the previous
   * Project stays on screen while that answer is in flight. Choosing the Project already chosen is
   * not a switch: clearing its list would ask for nothing to replace it.
   */
  selectProject(project: string): void {
    if (project === this.projects.chosen) {
      return;
    }
    this.projects.select(project);
    this.sessions.clear();
    this.transcript.clear();
    this.settings.clear();
    this.composer.clearError();
    this.commands.clear();
    this.subagents.clear();
    this.context.clear();
    this.tree.clear();
  }
}
