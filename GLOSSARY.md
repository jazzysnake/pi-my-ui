# pi-my-ui

A phone-first web UI for `pi`. A local server drives pi processes and keeps each conversation's state; the browser shows it and can disconnect and rejoin at any time.

## Language

**Project**:
The folder a Session's Pi child runs in, and whose files the server serves. One Project is one absolute path, and a directory is a Project only once it is registered with the server.
_Avoid_: Cwd, workspace, repo, folder, git root

**Workspace**:
The directory a server is anchored to: every Project discovered inside it is served, and nothing outside it is ever created.
_Avoid_: Root, workdir, projects folder

**Discovery**:
The walk of a Workspace that registers every directory holding a `.git` folder as a Project. The only thing a `.git` folder means to the server.
_Avoid_: Scan, traversal, sync

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

**Journey**:
A path a user takes across a seam, named by its outcome. One reason a test exists, not the only one: two tests may cover one Journey when their Claims differ.
_Avoid_: Flow, scenario, user story

**Claim**:
One sentence a test fails on if it turns false.
_Avoid_: Assertion, check, expectation

**Wiring claim**:
A Claim whose truth needs a real Pi child, a real socket, a real browser, or a real layout engine behind it.
_Avoid_: Integration test, end-to-end test

**Browser suite**:
The tests whose Claims need a real browser or a real layout engine; run by Playwright.
_Avoid_: E2E suite, end-to-end tests, frontend tests

**Backend suite**:
The tests whose Claims need a real server, socket or Pi child but no browser; run by vitest against the built server.
_Avoid_: Integration tests, server tests

**Rig**:
The harness, fixture builder, recorder and lint scripts that start and support tests, as distinct from the promises the tests check.
_Avoid_: Framework, tooling, infrastructure
