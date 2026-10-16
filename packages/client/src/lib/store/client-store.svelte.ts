/** The client's state, fed by one `ServerMessage` input. Slices by concern plug in here. */

import type { ServerMessage } from "@pi-my-ui/protocol";

import { createTranscriptSlice, type TranscriptSlice } from "./transcript.svelte.js";

export class ClientStore {
  readonly transcript: TranscriptSlice = createTranscriptSlice();

  receive(message: ServerMessage): void {
    this.transcript.receive(message);
  }
}
