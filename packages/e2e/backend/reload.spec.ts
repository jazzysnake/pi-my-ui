import { expect, test } from "vitest";

import { connectWsSession } from "../src/ws-session-client";
import {
  attach,
  readSurfaces,
  readUntil,
  reloadFrames,
  SKILL_COMMAND,
  startHarness,
  writeSkill,
} from "../src/reload-harness";

test("a reload starts a new child on the same Session file and re-reads pi's configuration", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    const { snapshot: before, surfaces } = await attach(client, session);
    const commands = surfaces.find((message) => message.type === "commands");
    if (commands?.type !== "commands") {
      throw new Error("the attach sent no Commands");
    }
    expect(commands.commands.map((command) => command.name)).not.toContain(SKILL_COMMAND);

    await writeSkill(harness);
    client.send({ type: "reload", session });
    const frames = await reloadFrames(client);

    // The order is the contract: a client that acts on the reply is already looking at the new state.
    expect(frames.map((message) => message.type)).toEqual([
      "snapshot",
      "settings",
      "commands",
      "contextUsage",
      "reloaded",
    ]);
    const [reseeded, settings, refreshed, usage, reply] = frames;
    if (
      reseeded?.type !== "snapshot" ||
      settings?.type !== "settings" ||
      refreshed?.type !== "commands" ||
      usage?.type !== "contextUsage" ||
      reply?.type !== "reloaded"
    ) {
      throw new Error("the reload answered with frames the order check did not name");
    }

    // The Session is its file, so everything that names it comes back from the new child unchanged.
    expect(reseeded.session).toEqual(session);
    expect(reseeded.projection.sessionId).toBe(before.projection.sessionId);
    expect(reseeded.projection.entries.map((entry) => entry.id)).toEqual(
      before.projection.entries.map((entry) => entry.id),
    );
    expect(reseeded.projection.leafId).toBe(before.projection.leafId);

    // The new child answers from the files it read at startup, so a skill written after the first
    // Commands frame is exactly what a reload adds.
    expect(refreshed.commands.map((command) => command.name)).toContain(SKILL_COMMAND);
    expect(settings.availableModels.length).toBeGreaterThan(0);

    expect(reply.session).toEqual(session);
    // The wording belongs to the client, so the reply carries nothing but the Session it names.
    expect(Object.keys(reply).sort()).toEqual(["session", "type"]);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a reload re-sends the surfaces to every viewer and answers only the requester", async () => {
  const harness = await startHarness();
  const requester = await connectWsSession(harness.server.url);
  const watcher = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    for (const viewer of [requester, watcher]) {
      viewer.send({ type: "subscribe", session });
      const snapshot = await viewer.next();
      expect(snapshot.type).toBe("snapshot");
      await readSurfaces(viewer);
    }

    requester.send({ type: "reload", session });
    expect((await reloadFrames(requester)).map((message) => message.type)).toEqual([
      "snapshot",
      "settings",
      "commands",
      "contextUsage",
      "reloaded",
    ]);

    // The second viewer's settings, palette and context figure came from the child that is gone, so
    // the reseed is not enough: it needs the same three surfaces, and no notice for someone else's
    // reload.
    watcher.send({ type: "getSessionStats", session });
    const watched = await readUntil(watcher, "sessionStats");
    const types = watched.map((message) => message.type);
    expect(types[0]).toBe("snapshot");
    expect(types).toEqual(expect.arrayContaining(["settings", "commands", "contextUsage"]));
    expect(types).not.toContain("reloaded");
  } finally {
    await watcher.close();
    await requester.close();
    await harness.dispose();
  }
});

test("a reload in one Session leaves another Session untouched", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  const other = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    const untouched = { project: harness.second, id: harness.secondSession.id };
    await attach(client, session);
    await attach(other, untouched);

    client.send({ type: "reload", session });
    expect((await reloadFrames(client)).at(-1)).toEqual({ type: "reloaded", session });

    // A reload is one Session and one child, so the other Project's Session sees no reseed at all,
    // and its own child answers a read without having been replaced.
    other.send({ type: "getSessionStats", session: untouched });
    const watched = await readUntil(other, "sessionStats");
    const types = watched.map((message) => message.type);
    expect(types).not.toContain("snapshot");
    expect(types).not.toContain("reloaded");
    const answered = watched.at(-1);
    if (answered?.type !== "sessionStats") {
      throw new Error("the untouched Session answered no statistics");
    }
    expect(answered.session).toEqual(untouched);
  } finally {
    await other.close();
    await client.close();
    await harness.dispose();
  }
});
