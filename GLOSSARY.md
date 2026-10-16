# pi-my-ui

A phone-first web UI for `pi`. A local server drives pi processes and keeps each conversation's state; the browser shows it and can disconnect and rejoin at any time.

## Language

**Session**:
One pi conversation, a tree of entries, persisted as a file.
_Avoid_: Chat, thread, conversation

**Pi child**:
The `pi` process the server runs for one Session.
_Avoid_: Worker, agent process, backend

**Projection**:
The server's current view of one Session (transcript, active Leaf, run state, subagents), as shown to the browser.
_Avoid_: State, model, store

**Snapshot**:
A full Projection plus a Cursor, sent to a browser that has nothing or has lost its place.

**Delta**:
One ordered change to a Projection since a given Cursor.
_Avoid_: Event, update, patch

**Cursor**:
A browser's position in a Session's stream of Deltas.

**Leaf**:
The entry in a Session's tree that new messages continue from.
_Avoid_: Head, current branch

**Bridge**:
The extension loaded into every Pi child that gives the server information and actions pi's RPC does not expose.
_Avoid_: Plugin, sidecar

**Subagent**:
An agent started by a Session to do part of its work.
_Avoid_: Child agent, worker
