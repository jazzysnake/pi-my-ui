/**
 * The two runtime producers of Projects beside the launch flags: the walk of the Workspace, and the
 * one directory a create makes. Neither runs a version-control command, because `.git` is only what
 * discovery looks for and choosing a repository is the user's next move.
 */

import { lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

import type { ProjectRegistry } from "./projects.js";

/** The one marker that makes a directory a discovered Project: a directory, or a worktree's file. */
const GIT_ENTRY = ".git";

/** A Project is a directory holding a `.git` entry, so the walk asks for that entry and nothing else. */
async function holdsGitEntry(directory: string): Promise<boolean> {
  try {
    await stat(join(directory, GIT_ENTRY));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every Project in the Workspace. Dot-directories and the inside of `.git` are pruned, a symlinked
 * directory is never entered, and there is no depth cap: the prunes bound the walk, and a cap would
 * silently hide a Project a few levels down. Nested Projects are all served.
 */
export async function discoverProjects(workspace: string): Promise<readonly string[]> {
  const root = await realpath(workspace);
  const found: string[] = [];
  const pending: string[] = [root];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    if (await holdsGitEntry(directory)) {
      found.push(directory);
    }
    // `withFileTypes` answers from the directory entry itself, so a symlink is not a directory here
    // and is never followed.
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      pending.push(join(directory, entry.name));
    }
  }
  return found;
}

export interface CreateProjectOptions {
  readonly registry: ProjectRegistry;
  /** The Workspace a created name is joined to; a server started without one cannot create. */
  readonly workspace: string | undefined;
  readonly name: string;
}

/**
 * Make one directory directly inside the Workspace, or adopt one an earlier process left, and
 * register it. The name is a single path segment, so a client can never name a path.
 */
export async function createProject(options: CreateProjectOptions): Promise<string> {
  const { registry, workspace, name } = options;
  if (workspace === undefined) {
    throw new ProtocolError(
      ProtocolErrorCode.NoWorkspace,
      "this server was started with no workspace, so it has nowhere to create a Project",
    );
  }
  refuseInvalidName(name);
  const path = join(workspace, name);
  // `lstat`, so a symlink is refused like a file: discovery never enters a symlinked directory, so a
  // link could only become a Project that the two routes disagree about.
  const existing = await lstat(path).catch(() => undefined);
  if (existing === undefined) {
    await mkdir(path);
    try {
      const created = await realpath(path);
      registry.register(created);
      return created;
    } catch (error) {
      // A half-made Project must never appear, so the directory this request made goes with its
      // failure.
      await rm(path, { recursive: true, force: true });
      throw error;
    }
  }
  const resolved = await realpath(path);
  if (registry.has(resolved) || registry.has(path)) {
    throw new ProtocolError(
      ProtocolErrorCode.ProjectExists,
      `this server already serves the Project ${JSON.stringify(resolved)}`,
      resolved,
    );
  }
  if (!existing.isDirectory()) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidProjectName,
      `${JSON.stringify(name)} already exists in the workspace and is not a directory`,
      path,
    );
  }
  registry.register(resolved);
  return resolved;
}

/**
 * A created name must be one directory name directly inside the Workspace. A dot-led name covers `.`
 * and `..` too, and discovery prunes dot-directories, so such a Project could never be found by both
 * routes.
 */
function refuseInvalidName(name: string): void {
  if (name === "" || name.includes("/") || name.includes("\0") || name.startsWith(".")) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidProjectName,
      `${JSON.stringify(name)} is not one directory name`,
      name,
    );
  }
}
