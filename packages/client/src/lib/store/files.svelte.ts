/**
 * The file tree's data, fed by one `ServerMessage` input like every other slice. It holds what the
 * server sent, keyed by the relative path it answers for, so a component can render a node the moment
 * its listing arrives and show a refusal against the node it asked about.
 */

import {
  ServerMessageType,
  type DirectoryListingMessage,
  type FilePreviewMessage,
  type ServerMessage,
} from "@pi-my-ui/protocol";

export interface FilesSlice {
  /** The listing a directory has received, or `undefined` while it is unknown or loading. */
  listingFor(path: string): DirectoryListingMessage | undefined;
  /** The typed failure a listing received, so a failed node is never shown as an empty directory. */
  failureFor(path: string): string | undefined;
  /** The preview a file has received, or `undefined` before it is asked for or loaded. */
  previewFor(path: string): FilePreviewMessage | undefined;
  receive(message: ServerMessage): void;
}

export function createFilesSlice(): FilesSlice {
  let listings = $state<Record<string, DirectoryListingMessage>>({});
  let failures = $state<Record<string, string>>({});
  let previews = $state<Record<string, FilePreviewMessage>>({});

  return {
    listingFor(path) {
      return listings[path];
    },
    failureFor(path) {
      return failures[path];
    },
    previewFor(path) {
      return previews[path];
    },
    receive(message) {
      if (message.type === ServerMessageType.DirectoryListing) {
        listings = { ...listings, [message.path]: message };
        if (failures[message.path] !== undefined) {
          const cleared = { ...failures };
          delete cleared[message.path];
          failures = cleared;
        }
        return;
      }
      if (message.type === ServerMessageType.FilePreview) {
        previews = { ...previews, [message.path]: message };
        return;
      }
      // A path-bearing error is a file refusal; the detail is what ties it to the node that asked.
      if (message.type === ServerMessageType.Error && message.error.detail !== undefined) {
        failures = { ...failures, [message.error.detail]: message.error.message };
      }
    },
  };
}
