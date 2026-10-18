/**
 * The tree slice: the message tree the server answered for the watched Session, the entry whose Leaf
 * move is in flight, and the message text a confirmed move hands back to the composer.
 *
 * The modal is server-answered and server-confirmed. It opens empty and says it is loading, and it
 * closes only on a confirmed move, so a refused move can never read as a switch that happened.
 */

import {
  MessageRole,
  ServerMessageType,
  type ServerMessage,
  type SessionRef,
  type SessionTree,
  type TreeNode,
  sessionMatches,
} from "@pi-my-ui/protocol";

export interface TreeSlice {
  /** Whether the modal is up. */
  readonly open: boolean;
  /** The Session's tree, or `null` until the server answers. */
  readonly tree: SessionTree | null;
  /** The tree has been asked for and has not arrived. */
  readonly loading: boolean;
  /** Why the tree could not be read, in the server's words, or `null`. */
  readonly error: string | null;
  /** The entry whose move is awaiting the server's answer, or `null`. */
  readonly movingEntryId: string | null;
  /** Why the last move was refused, in the server's words, or `null`. */
  readonly moveError: string | null;
  /** The text a confirmed move returned to the composer, or `null` when nothing is waiting. */
  readonly draft: { readonly text: string } | null;
  /** Open the modal; the tree itself is the answer a caller asks the server for next. */
  begin(): void;
  close(): void;
  /** Ask for the Leaf to move to `entry`, remembering what a user message hands back. */
  select(entry: TreeNode): void;
  receive(message: ServerMessage): void;
  clear(): void;
}

export function createTreeSlice(): TreeSlice {
  let active: SessionRef | null = null;
  let open = $state(false);
  let tree = $state<SessionTree | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let movingEntryId = $state<string | null>(null);
  let moveError = $state<string | null>(null);
  let draft = $state<{ readonly text: string } | null>(null);
  /**
   * The text the in-flight move would hand back. It is held outside the reactive state because the
   * composer must receive it only when the move is confirmed.
   */
  let movingText: string | null = null;

  function forget(): void {
    tree = null;
    loading = false;
    error = null;
    movingEntryId = null;
    moveError = null;
    movingText = null;
  }

  return {
    get open() {
      return open;
    },
    get tree() {
      return tree;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get movingEntryId() {
      return movingEntryId;
    },
    get moveError() {
      return moveError;
    },
    get draft() {
      return draft;
    },
    begin() {
      open = true;
      forget();
      loading = true;
    },
    close() {
      open = false;
      loading = false;
      movingEntryId = null;
      movingText = null;
      moveError = null;
    },
    select(entry) {
      movingEntryId = entry.entry.id;
      moveError = null;
      draft = null;
      // Only a user message's text goes back to the composer; a selection anywhere else leaves the
      // draft alone rather than throwing away whatever the user had typed.
      movingText = entry.entry.role === MessageRole.User ? entry.entry.text : null;
    },
    receive(message) {
      if (message.type === ServerMessageType.Snapshot) {
        // A Snapshot for another Session is ignored: switching Sessions clears this slice, so the next
        // Snapshot is accepted without the old one closing a tree the reader has open.
        if (active !== null && !sessionMatches(active, message.session)) {
          return;
        }
        active = message.session;
        return;
      }
      if (message.type === ServerMessageType.SessionTree) {
        if (!sessionMatches(active, message.session)) {
          return;
        }
        tree = message.tree;
        loading = false;
        error = null;
        return;
      }
      if (message.type === ServerMessageType.LeafMoved) {
        if (!sessionMatches(active, message.session) || message.entryId !== movingEntryId) {
          return;
        }
        draft = movingText === null ? null : { text: movingText };
        movingText = null;
        movingEntryId = null;
        moveError = null;
        open = false;
        return;
      }
      if (
        message.type !== ServerMessageType.Error ||
        message.session === undefined ||
        !sessionMatches(active, message.session)
      ) {
        return;
      }
      // A failure that names an entry belongs to the move that asked about it; one without a detail
      // arrived while the tree was being read.
      if (message.error.detail !== undefined && message.error.detail === movingEntryId) {
        moveError = message.error.message;
        movingEntryId = null;
        movingText = null;
        return;
      }
      if (loading && message.error.detail === undefined) {
        error = message.error.message;
        loading = false;
      }
    },
    clear() {
      active = null;
      open = false;
      draft = null;
      forget();
    },
  };
}
