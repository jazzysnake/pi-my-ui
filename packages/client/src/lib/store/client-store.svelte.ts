/** The client's state, fed by one `ServerMessage` input. Slices by concern plug in here. */

import type { ServerMessage } from "@pi-my-ui/protocol";

import { createComposerSlice, type ComposerSlice } from "./composer.svelte.js";
import { createCommandsSlice, type CommandsSlice } from "./commands.svelte.js";
import { createFilesSlice, type FilesSlice } from "./files.svelte.js";
import { createSessionsSlice, type SessionsSlice } from "./sessions.svelte.js";
import { createSettingsSlice, type SettingsSlice } from "./settings.svelte.js";
import { createSubagentsSlice, type SubagentsSlice } from "./subagents.svelte.js";
import { createTranscriptSlice, type TranscriptSlice } from "./transcript.svelte.js";

export class ClientStore {
  readonly transcript: TranscriptSlice = createTranscriptSlice();
  readonly files: FilesSlice = createFilesSlice();
  readonly sessions: SessionsSlice = createSessionsSlice();
  readonly settings: SettingsSlice = createSettingsSlice();
  readonly composer: ComposerSlice = createComposerSlice();
  readonly commands: CommandsSlice = createCommandsSlice();
  readonly subagents: SubagentsSlice = createSubagentsSlice();

  receive(message: ServerMessage): void {
    this.transcript.receive(message);
    this.files.receive(message);
    this.sessions.receive(message);
    this.settings.receive(message);
    this.composer.receive(message);
    this.commands.receive(message);
    this.subagents.receive(message);
  }

  /**
   * Switch the watched Session. The transcript is dropped rather than left to be replaced when the
   * new Snapshot arrives, so the previous Session is never drawn under the new one's name.
   */
  selectSession(sessionId: string): void {
    this.sessions.select(sessionId);
    this.transcript.clear();
    this.settings.clear();
    this.composer.clearError();
    this.commands.clear();
    this.subagents.clear();
  }
}
