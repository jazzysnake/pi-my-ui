import { expect, test } from "vitest";

import { connectWsSession } from "../src/ws-session-client";
import {
  disposeHarness,
  nextFrameOfType,
  REPLY_SCRIPT,
  startHarness,
} from "../src/multi-project-server-harness";

test("a connection watching one Project is pushed no other Project's list", async () => {
  const harness = await startHarness();
  const firstViewer = await connectWsSession(harness.server.url);
  const secondViewer = await connectWsSession(harness.server.url);
  try {
    firstViewer.send({ type: "listSessions", project: harness.first });
    expect(await firstViewer.next()).toMatchObject({ type: "sessions", project: harness.first });

    secondViewer.send({ type: "listSessions", project: harness.second });
    expect(await secondViewer.next()).toMatchObject({ type: "sessions", project: harness.second });

    // A fresh Session pushes the list of the Project it was created in. The two connections watch
    // different Projects, so only the one that asked for the second may hear about it.
    secondViewer.send({ type: "createSession", project: harness.second });
    expect(await secondViewer.next()).toMatchObject({
      type: "sessionCreated",
      session: { project: harness.second },
    });
    expect(await secondViewer.next()).toMatchObject({
      type: "sessions",
      project: harness.second,
    });

    // The server writes that push before it answers anything else this connection sends, so a list
    // for the second Project would arrive ahead of this answer if the push had been widened.
    firstViewer.send({ type: "listSessions", project: harness.first });
    const afterPush = await firstViewer.next();
    expect(afterPush).toMatchObject({ type: "sessions", project: harness.first });
    if (afterPush.type !== "sessions") {
      return;
    }
    expect(afterPush.sessions.map((session) => session.id)).toEqual([harness.firstSession.id]);
  } finally {
    await firstViewer.close();
    await secondViewer.close();
    await disposeHarness(harness);
  }
});

test("a pair naming an id from another Project is refused and nothing is searched", async () => {
  const harness = await startHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({
      type: "subscribe",
      session: { project: harness.second, id: harness.firstSession.id },
    });
    const refused = await client.next();
    expect(refused).toMatchObject({
      type: "error",
      error: { code: "unknownSession" },
      session: { project: harness.second, id: harness.firstSession.id },
    });

    // The refused id was not looked for anywhere: the second Project's own list is unchanged, and
    // the first Project still holds the Session the pair named.
    client.send({ type: "listSessions", project: harness.second });
    const secondList = await client.next();
    expect(secondList.type).toBe("sessions");
    if (secondList.type !== "sessions") {
      return;
    }
    expect(secondList.sessions.map((session) => session.id)).toEqual([harness.secondSession.id]);

    client.send({ type: "listSessions", project: harness.first });
    const firstList = await client.next();
    expect(firstList.type).toBe("sessions");
    if (firstList.type !== "sessions") {
      return;
    }
    expect(firstList.sessions.map((session) => session.id)).toEqual([harness.firstSession.id]);
  } finally {
    await client.close();
    await disposeHarness(harness);
  }
});

test("a refused pair leaves the Session the connection was watching attached", async () => {
  const harness = await startHarness(REPLY_SCRIPT);
  const watcher = await connectWsSession(harness.server.url);
  const runner = await connectWsSession(harness.server.url);
  try {
    const session = { project: harness.first, id: harness.firstSession.id };
    watcher.send({ type: "subscribe", session });
    expect((await nextFrameOfType(watcher, "snapshot")).session).toEqual(session);

    // The pair names an id the second Project does not hold, so the server refuses it.
    watcher.send({ type: "subscribe", session: { project: harness.second, id: session.id } });
    expect(await nextFrameOfType(watcher, "error")).toMatchObject({
      type: "error",
      error: { code: "unknownSession" },
      session: { project: harness.second, id: session.id },
    });

    // The run reaches the Session the connection was legitimately watching, so the refusal did not
    // detach the attach that refused pair never replaced.
    runner.send({ type: "prompt", session, text: "hello there" });
    expect((await nextFrameOfType(watcher, "delta")).session).toEqual(session);
  } finally {
    await watcher.close();
    await runner.close();
    await disposeHarness(harness);
  }
});

test("renaming in one Project refreshes only that Project's list", async () => {
  const harness = await startHarness();
  const firstViewer = await connectWsSession(harness.server.url);
  const secondViewer = await connectWsSession(harness.server.url);
  try {
    firstViewer.send({ type: "listSessions", project: harness.first });
    expect((await nextFrameOfType(firstViewer, "sessions")).project).toBe(harness.first);
    secondViewer.send({ type: "listSessions", project: harness.second });
    expect((await nextFrameOfType(secondViewer, "sessions")).project).toBe(harness.second);

    const renamed = "Renamed inside the second Project";
    secondViewer.send({
      type: "setSessionName",
      session: { project: harness.second, id: harness.secondSession.id },
      name: renamed,
    });
    expect((await nextFrameOfType(secondViewer, "sessionRenamed")).session).toEqual({
      project: harness.second,
      id: harness.secondSession.id,
    });
    const pushed = await nextFrameOfType(secondViewer, "sessions");
    expect(pushed.project).toBe(harness.second);
    expect(pushed.sessions.find((session) => session.id === harness.secondSession.id)?.name).toBe(
      renamed,
    );

    // A list push for the second Project would arrive before this answer if it had been sent to the
    // connection watching the first Project.
    firstViewer.send({ type: "listSessions", project: harness.first });
    const firstList = await nextFrameOfType(firstViewer, "sessions");
    expect(firstList.project).toBe(harness.first);
    expect(firstList.sessions.map((session) => session.id)).toEqual([harness.firstSession.id]);
    expect(firstList.sessions.some((session) => session.name === renamed)).toBe(false);
  } finally {
    await firstViewer.close();
    await secondViewer.close();
    await disposeHarness(harness);
  }
});
