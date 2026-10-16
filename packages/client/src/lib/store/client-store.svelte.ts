/** The client's state, fed by one `ServerMessage` input. Slices by concern plug in here. */

import type { ServerMessage } from "@pi-my-ui/protocol";

import { createFilesSlice, type FilesSlice } from "./files.svelte.js";
import { createSessionsSlice, type SessionsSlice } from "./sessions.svelte.js";
import { createTranscriptSlice, type TranscriptSlice } from "./transcript.svelte.js";

export class ClientStore {
  readonly transcript: TranscriptSlice = createTranscriptSlice();
  readonly files: FilesSlice = createFilesSlice();
  readonly sessions: SessionsSlice = createSessionsSlice();

  receive(message: ServerMessage): void {
    this.transcript.receive(message);
    this.files.receive(message);
    this.sessions.receive(message);
  }

  /**
   * Switch the watched Session. The transcript is dropped rather than left to be replaced when the
   * new Snapshot arrives, so the previous Session is never drawn under the new one's name.
   */
  selectSession(sessionId: string): void {
    this.sessions.select(sessionId);
    this.transcript.clear();
  }
}
