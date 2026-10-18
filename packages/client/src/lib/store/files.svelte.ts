/**
 * The file tree's data, fed by one `ServerMessage` input like every other slice. It holds what the
 * server sent, keyed by the relative path it answers for, so a component can render a node the moment
 * its listing arrives and show a refusal against the node it asked about.
 *
 * Every answer is about one Project, and the slice holds one Project's answers. An answer for
 * another Project is dropped rather than rendered under the current one, and a different chosen
 * Project drops everything held: a relative path means nothing without the root it was resolved
 * against.
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
  /** Point the slice at the chosen Project, dropping the previous Project's answers. */
  follow(project: string | null): void;
  receive(message: ServerMessage): void;
}

export function createFilesSlice(): FilesSlice {
  let project = $state<string | null>(null);
  let listings = $state<Record<string, DirectoryListingMessage>>({});
  let failures = $state<Record<string, string>>({});
  let previews = $state<Record<string, FilePreviewMessage>>({});

  function reset(): void {
    listings = {};
    failures = {};
    previews = {};
  }

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
    follow(next) {
      if (next === project) {
        return;
      }
      project = next;
      reset();
    },
    receive(message) {
      if (message.type === ServerMessageType.DirectoryListing) {
        if (message.project !== project) {
          return;
        }
        listings = { ...listings, [message.path]: message };
        if (failures[message.path] !== undefined) {
          const cleared = { ...failures };
          delete cleared[message.path];
          failures = cleared;
        }
        return;
      }
      if (message.type === ServerMessageType.FilePreview) {
        if (message.project !== project) {
          return;
        }
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
