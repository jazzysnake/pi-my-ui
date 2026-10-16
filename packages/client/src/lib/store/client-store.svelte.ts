/** The client's state, fed by one `ServerMessage` input. Slices by concern plug in here. */

import type { ServerMessage } from "@pi-my-ui/protocol";

import { createFilesSlice, type FilesSlice } from "./files.svelte.js";
import { createTranscriptSlice, type TranscriptSlice } from "./transcript.svelte.js";

export class ClientStore {
  readonly transcript: TranscriptSlice = createTranscriptSlice();
  readonly files: FilesSlice = createFilesSlice();

  receive(message: ServerMessage): void {
    this.transcript.receive(message);
    this.files.receive(message);
  }
}
