/**
 * The Workspace half of the backend: discovery registers what a walk finds, creation makes one
 * directory inside it, and both are observed the way a client observes them — over a real socket
 * against a real server, a real temporary Workspace and the real filesystem.
 */

import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  ContentBlockType,
  EntryKind,
  MessageRole,
  ProjectionDeltaKind,
  type ServerMessage,
} from "@pi-my-ui/protocol";
import { startServer, type RunningServer } from "@pi-my-ui/server";
import { expect, test } from "vitest";

import { UNUSED_SCRIPT, nextFrameOfType } from "../src/multi-project-server-harness";
import { piChildPids } from "../src/pi-processes";
import { createHermeticHome, scriptedPiLaunch, type HermeticHome } from "../src/pi-harness";
import { connectWsSession, type WsSessionClient } from "../src/ws-session-client";

type ProjectsAnswer = Extract<ServerMessage, { type: "projects" }>;

interface WorkspaceHarness {
  readonly home: HermeticHome;
  readonly workspace: string;
  readonly server: RunningServer;
  dispose(): Promise<void>;
}

interface WorkspaceOptions {
  /** `false` starts the server the way every spec that names only Projects does. */
  readonly workspace?: boolean;
  /** Projects to name with the launch flags, resolved once the temporary Workspace exists. */
  readonly projects?: (workspace: string) => readonly string[];
}

/** One real server over a fresh temporary Workspace, with the scripted provider behind its children. */
async function startWorkspaceHarness(options: WorkspaceOptions = {}): Promise<WorkspaceHarness> {
  const home = await createHermeticHome();
  const launch = await scriptedPiLaunch(home, UNUSED_SCRIPT);
  const workspace = await realpath(home.workspace);
  const server = await startServer({
    projects: options.projects?.(workspace) ?? [],
    ...(options.workspace === false ? {} : { workspace }),
    sessionDir: home.sessionsDir,
    port: home.ports.allocate(),
    pi: {
      args: launch.args,
      env: launch.env,
      provider: launch.provider,
      model: launch.model,
    },
  });
  return {
    home,
    workspace,
    server,
    dispose: async () => {
      await server.close();
      await home.dispose();
    },
  };
}

/** Mark `directory` the way a repository checkout is marked: a `.git` entry, created here. */
async function markProject(directory: string): Promise<void> {
  await mkdir(join(directory, ".git"), { recursive: true });
}

/** Root ignores a mode, and Windows has no such bit, so an unreadable-directory case only holds here. */
const directoryPermissionApplies =
  process.platform !== "win32" && !(typeof process.getuid === "function" && process.getuid() === 0);

async function askProjects(client: WsSessionClient): Promise<ProjectsAnswer> {
  client.send({ type: "listProjects" });
  return await nextFrameOfType(client, "projects");
}

async function listProjects(harness: WorkspaceHarness): Promise<ProjectsAnswer> {
  const client = await connectWsSession(harness.server.url);
  try {
    return await askProjects(client);
  } finally {
    await client.close();
  }
}

/** Read until a direct shell command's card carries its finished output, and answer that output. */
async function untilShellOutput(client: WsSessionClient): Promise<string> {
  for (let read = 0; read < 200; read += 1) {
    const message = await client.next();
    if (message.type !== "delta") {
      continue;
    }
    for (const delta of message.deltas) {
      if (delta.kind !== ProjectionDeltaKind.EntryUpsert) {
        continue;
      }
      const entry = delta.entry;
      if (entry.kind !== EntryKind.Message || entry.role !== MessageRole.Bash) {
        continue;
      }
      for (const block of entry.blocks) {
        if (block.type === ContentBlockType.BashExecution && block.result !== undefined) {
          return block.output;
        }
      }
    }
  }
  throw new Error("the shell card never finished");
}

test("discovery serves a directory holding a .git entry and skips dot-directories", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const nested = join(harness.workspace, "deep", "two-levels");
    await markProject(harness.workspace);
    await markProject(nested);
    await markProject(join(harness.workspace, ".hidden", "repo"));
    // The inside of `.git` is pruned, so a checkout nested under the marker is not walked into.
    await markProject(join(harness.workspace, ".git", "modules", "vendored"));

    const answer = await listProjects(harness);
    expect(answer.workspace).toBe(harness.workspace);
    expect(new Set(answer.projects)).toEqual(new Set([harness.workspace, nested]));
  } finally {
    await harness.dispose();
  }
});

test("a .git file marks a Project the way a worktree or submodule checkout does", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const worktree = join(harness.workspace, "worktree");
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, ".git"), `gitdir: ${join(harness.workspace, "main", ".git")}\n`);

    const answer = await listProjects(harness);
    expect(answer.projects).toEqual([worktree]);
  } finally {
    await harness.dispose();
  }
});

test("a symlinked directory inside the Workspace is not entered", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const outside = join(harness.home.root, "outside");
    await markProject(outside);
    await symlink(outside, join(harness.workspace, "linked"));

    const answer = await listProjects(harness);
    expect(answer.projects).toEqual([]);
  } finally {
    await harness.dispose();
  }
});

test.skipIf(!directoryPermissionApplies)(
  "a directory the walk cannot read is skipped, and the Projects it could see are still served",
  async () => {
    const harness = await startWorkspaceHarness();
    const locked = join(harness.workspace, "locked");
    const readable = join(harness.workspace, "readable");
    await mkdir(locked, { recursive: true });
    await markProject(join(locked, "inside"));
    await markProject(readable);
    await chmod(locked, 0o000);
    try {
      // One directory this process cannot read costs its own subtree, never the whole answer.
      expect((await listProjects(harness)).projects).toEqual([readable]);
    } finally {
      // The mode has to come back before the temporary tree can be removed.
      await chmod(locked, 0o700);
      await harness.dispose();
    }
  },
);

test("nested Projects are both served, and a flag naming one of them adds no second row", async () => {
  const harness = await startWorkspaceHarness({
    projects: (workspace) => [join(workspace, "outer", "inner")],
  });
  try {
    const outer = join(harness.workspace, "outer");
    const inner = join(outer, "inner");
    await markProject(outer);
    await markProject(inner);

    const answer = await listProjects(harness);
    // The flag keeps its typed place, and the walk that also found the same directory adds nothing.
    expect(answer.projects).toEqual([inner, outer]);
  } finally {
    await harness.dispose();
  }
});

test("a created Project is a directory a Session then runs in", async () => {
  const harness = await startWorkspaceHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const expected = join(harness.workspace, "new-idea");
    client.send({ type: "createProject", name: "new-idea" });
    expect(await nextFrameOfType(client, "projectCreated")).toEqual({
      type: "projectCreated",
      project: expected,
    });
    // The server made the directory and nothing else: no repository, no file, no Session.
    expect((await stat(expected)).isDirectory()).toBe(true);
    expect(await readdir(expected)).toEqual([]);

    expect((await askProjects(client)).projects).toEqual([expected]);

    client.send({ type: "createSession", project: expected });
    const created = await nextFrameOfType(client, "sessionCreated");
    expect(created.session.project).toBe(expected);

    // The Session's child really runs in the directory this request made, not in the Workspace.
    client.send({ type: "subscribe", session: created.session });
    await nextFrameOfType(client, "snapshot");
    expect(piChildPids()).toHaveLength(1);
    client.send({
      type: "bash",
      session: created.session,
      command: "pwd",
      excludeFromContext: false,
    });
    expect((await untilShellOutput(client)).trim()).toBe(expected);

    // The Project the create registered is one the Session answers accept, so its list is answered
    // rather than refused as an unknown Project.
    const observer = await connectWsSession(harness.server.url);
    try {
      observer.send({ type: "listSessions", project: expected });
      expect((await nextFrameOfType(observer, "sessions")).project).toBe(expected);
    } finally {
      await observer.close();
    }
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a name that cannot become one directory is refused, and makes nothing", async () => {
  const harness = await startWorkspaceHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    for (const name of ["", "two/levels", ".", "..", ".hidden", "nul\u0000inside"]) {
      client.send({ type: "createProject", name });
      expect(await nextFrameOfType(client, "error")).toMatchObject({
        type: "error",
        error: { code: "invalidProjectName" },
      });
    }
    await writeFile(join(harness.workspace, "notes.txt"), "kept\n", "utf8");
    client.send({ type: "createProject", name: "notes.txt" });
    expect(await nextFrameOfType(client, "error")).toMatchObject({
      type: "error",
      error: { code: "invalidProjectName" },
    });
    expect(await readFile(join(harness.workspace, "notes.txt"), "utf8")).toBe("kept\n");
    expect(await readdir(harness.workspace)).toEqual(["notes.txt"]);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("creating a name that exists as an unregistered directory registers it", async () => {
  const harness = await startWorkspaceHarness();
  const pending = join(harness.workspace, "already-there");
  await mkdir(pending, { recursive: true });
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({ type: "createProject", name: "already-there" });
    expect(await nextFrameOfType(client, "projectCreated")).toEqual({
      type: "projectCreated",
      project: pending,
    });
    expect((await askProjects(client)).projects).toEqual([pending]);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("creating a name this server already serves is refused, however it was registered", async () => {
  const harness = await startWorkspaceHarness();
  const discovered = join(harness.workspace, "was-cloned");
  await markProject(discovered);
  const client = await connectWsSession(harness.server.url);
  try {
    client.send({ type: "createProject", name: "fresh" });
    expect(await nextFrameOfType(client, "projectCreated")).toEqual({
      type: "projectCreated",
      project: join(harness.workspace, "fresh"),
    });
    client.send({ type: "createProject", name: "fresh" });
    expect(await nextFrameOfType(client, "error")).toMatchObject({
      type: "error",
      error: { code: "projectExists" },
    });

    // The walk registered the other one, so the same refusal covers a Project this process never made.
    expect((await askProjects(client)).projects).toContain(discovered);
    client.send({ type: "createProject", name: "was-cloned" });
    expect(await nextFrameOfType(client, "error")).toMatchObject({
      type: "error",
      error: { code: "projectExists" },
    });
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a server started with no Workspace refuses a create and names none", async () => {
  const harness = await startWorkspaceHarness({
    workspace: false,
    projects: (workspace) => [workspace],
  });
  const client = await connectWsSession(harness.server.url);
  try {
    expect(await askProjects(client)).toEqual({
      type: "projects",
      projects: [harness.workspace],
      workspace: null,
    });
    client.send({ type: "createProject", name: "nowhere" });
    expect(await nextFrameOfType(client, "error")).toMatchObject({
      type: "error",
      error: { code: "noWorkspace" },
    });
    expect(await readdir(harness.workspace)).toEqual([]);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("another connection is pushed the fresh list after a create", async () => {
  const harness = await startWorkspaceHarness();
  const creator = await connectWsSession(harness.server.url);
  const watcher = await connectWsSession(harness.server.url);
  try {
    const expected = join(harness.workspace, "shared");
    creator.send({ type: "createProject", name: "shared" });
    expect(await nextFrameOfType(creator, "projectCreated")).toEqual({
      type: "projectCreated",
      project: expected,
    });
    // The watching device is pushed the whole list, which is the only way it learns of the new row.
    expect(await watcher.next()).toEqual({
      type: "projects",
      projects: [expected],
      workspace: harness.workspace,
    });
  } finally {
    await creator.close();
    await watcher.close();
    await harness.dispose();
  }
});

test("a Workspace with nothing in it answers an empty list and starts no Pi child", async () => {
  const harness = await startWorkspaceHarness();
  try {
    expect(await listProjects(harness)).toEqual({
      type: "projects",
      projects: [],
      workspace: harness.workspace,
    });
    expect(piChildPids()).toEqual([]);
  } finally {
    await harness.dispose();
  }
});

test("the list is flag Projects in typed order, then derived ones newest first, ties by path", async () => {
  const harness = await startWorkspaceHarness({
    projects: (workspace) => [join(workspace, "zz-flag"), join(workspace, "aa-flag")],
  });
  try {
    await mkdir(join(harness.workspace, "zz-flag"), { recursive: true });
    await mkdir(join(harness.workspace, "aa-flag"), { recursive: true });
    const newer = join(harness.workspace, "newer");
    const older = join(harness.workspace, "older");
    const tieA = join(harness.workspace, "tie-a");
    const tieB = join(harness.workspace, "tie-b");
    for (const directory of [newer, older, tieA, tieB]) {
      await markProject(directory);
    }
    const base = new Date("2024-05-01T00:00:00Z");
    const at = (secondsAgo: number): Date => new Date(base.getTime() - secondsAgo * 1_000);
    // mtime is what the derived order reads, so each candidate is stamped after its contents exist.
    await utimes(newer, at(10), at(10));
    await utimes(older, at(300), at(300));
    await utimes(tieB, at(60), at(60));
    await utimes(tieA, at(60), at(60));

    expect((await listProjects(harness)).projects).toEqual([
      join(harness.workspace, "zz-flag"),
      join(harness.workspace, "aa-flag"),
      newer,
      tieA,
      tieB,
      older,
    ]);
  } finally {
    await harness.dispose();
  }
});

test("a Project whose directory is deleted leaves the next list", async () => {
  const harness = await startWorkspaceHarness();
  const client = await connectWsSession(harness.server.url);
  try {
    const doomed = join(harness.workspace, "doomed");
    const kept = join(harness.workspace, "kept");
    await markProject(doomed);
    await markProject(kept);
    expect(new Set((await askProjects(client)).projects)).toEqual(new Set([doomed, kept]));

    client.send({ type: "createProject", name: "made-here" });
    const made = await nextFrameOfType(client, "projectCreated");
    expect(new Set((await askProjects(client)).projects)).toEqual(
      new Set([doomed, kept, made.project]),
    );

    await rm(doomed, { recursive: true, force: true });
    await rm(made.project, { recursive: true, force: true });
    expect((await askProjects(client)).projects).toEqual([kept]);
  } finally {
    await client.close();
    await harness.dispose();
  }
});

test("a node_modules directory is not walked, with no .gitignore anywhere", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const app = join(harness.workspace, "web");
    await markProject(app);
    await markProject(join(app, "node_modules", "a-dependency"));

    expect((await listProjects(harness)).projects).toEqual([app]);
  } finally {
    await harness.dispose();
  }
});

test("a __pycache__ directory is not walked, with no .gitignore anywhere", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const tool = join(harness.workspace, "reporting");
    await markProject(tool);
    await markProject(join(tool, "jobs", "__pycache__"));

    expect((await listProjects(harness)).projects).toEqual([tool]);
  } finally {
    await harness.dispose();
  }
});

test("a root .gitignore hides a marked directory inside what it excludes", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const kept = join(harness.workspace, "kept");
    await markProject(kept);
    await markProject(join(harness.workspace, "vendor", "checkout"));
    await writeFile(join(harness.workspace, ".gitignore"), "vendor/\n", "utf8");

    expect((await listProjects(harness)).projects).toEqual([kept]);
  } finally {
    await harness.dispose();
  }
});

test("a nested .gitignore applies to its own subtree and not to a sibling", async () => {
  const harness = await startWorkspaceHarness();
  try {
    const ignoresBuild = join(harness.workspace, "ignores-build");
    await mkdir(ignoresBuild, { recursive: true });
    await writeFile(join(ignoresBuild, ".gitignore"), "build/\n", "utf8");
    await markProject(join(ignoresBuild, "build", "checkout"));
    const sibling = join(harness.workspace, "sibling", "build", "checkout");
    await markProject(sibling);

    expect((await listProjects(harness)).projects).toEqual([sibling]);
  } finally {
    await harness.dispose();
  }
});

test("a rule from an ancestor .gitignore still applies one level down", async () => {
  const harness = await startWorkspaceHarness();
  try {
    await writeFile(join(harness.workspace, ".gitignore"), "build/\n", "utf8");
    await markProject(join(harness.workspace, "app", "build", "checkout"));
    const kept = join(harness.workspace, "app", "source");
    await markProject(kept);

    expect((await listProjects(harness)).projects).toEqual([kept]);
  } finally {
    await harness.dispose();
  }
});

test("a later negation re-includes a directory an earlier line excluded, and the walk enters it", async () => {
  const harness = await startWorkspaceHarness();
  try {
    await writeFile(join(harness.workspace, ".gitignore"), "gone/\n!gone/\ndropped/\n", "utf8");
    const reopened = join(harness.workspace, "gone", "checkout");
    await markProject(reopened);
    // The same walk skips the directory no line re-opens, so the negation is what kept the other.
    await markProject(join(harness.workspace, "dropped", "checkout"));

    expect((await listProjects(harness)).projects).toEqual([reopened]);
  } finally {
    await harness.dispose();
  }
});

test.skipIf(!directoryPermissionApplies)(
  "a .gitignore the walk cannot read is ignored, and the Projects it could see are still served",
  async () => {
    const harness = await startWorkspaceHarness();
    const guarded = join(harness.workspace, "guarded");
    const insideExcluded = join(guarded, "vendor", "checkout");
    const readable = join(harness.workspace, "readable");
    try {
      await mkdir(guarded, { recursive: true });
      await mkdir(readable, { recursive: true });
      await writeFile(join(guarded, ".gitignore"), "vendor/\n", "utf8");
      await writeFile(join(readable, ".gitignore"), "vendor/\n", "utf8");
      await markProject(insideExcluded);
      await markProject(join(readable, "vendor", "checkout"));
      await chmod(join(guarded, ".gitignore"), 0o000);

      // The rules this process cannot read cost nothing but themselves, and the readable file in the
      // same walk still applies.
      expect((await listProjects(harness)).projects).toEqual([insideExcluded]);
    } finally {
      await chmod(join(guarded, ".gitignore"), 0o600);
      await harness.dispose();
    }
  },
);

test("dot-directories stay pruned, which is what keeps .venv and .venvs out of the walk", async () => {
  const harness = await startWorkspaceHarness();
  try {
    await markProject(join(harness.workspace, ".venv", "checkout"));
    await markProject(join(harness.workspace, ".venvs", "checkout"));

    expect((await listProjects(harness)).projects).toEqual([]);
  } finally {
    await harness.dispose();
  }
});
