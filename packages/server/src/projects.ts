/**
 * The Projects one running server serves. Three producers register a directory: the launcher's flags,
 * a create in this process, and the last walk of the Workspace. The registry is memory-only, so the
 * filesystem stays the authority over what exists and a list is where a departed directory is dropped.
 */

import { statSync } from "node:fs";

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

export interface ProjectRegistry {
  /**
   * The Projects served right now: flag Projects first in typed order, then the created and
   * discovered ones, newest directory first and ties by path.
   */
  list(): readonly string[];
  has(project: string): boolean;
  /** The Project as served, or a typed refusal for a path no producer registered. */
  require(project: string): string;
  /** Record a Project this process created. Only a list can drop it again, by finding it gone. */
  register(project: string): void;
  /** Replace the walked half with what the latest walk found; nothing is cached between walks. */
  discover(projects: readonly string[]): void;
}

/** Ties in the derived order break by path, so two rows with one mtime still come out in one order. */
function byPath(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** A vanished Project is not served, and `throwIfNoEntry` keeps a departure from throwing. */
function directoryStats(path: string): ReturnType<typeof statSync> | undefined {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats?.isDirectory() === true ? stats : undefined;
}

export function createProjectRegistry(projects: readonly string[]): ProjectRegistry {
  // Zero Projects is the normal first-run state of a fresh Workspace; only a named Project that is
  // not registered is refused.
  const flags = [...projects];
  const created = new Set<string>();
  const walked = new Set<string>();

  function served(project: string): boolean {
    return flags.includes(project) || created.has(project) || walked.has(project);
  }

  /** The derived half, newest directory first: the two books a walk and a create keep. */
  function derived(): { readonly path: string; readonly modifiedMs: number }[] {
    const rows = new Map<string, number>();
    for (const book of [created, walked]) {
      for (const project of book) {
        if (flags.includes(project) || rows.has(project)) {
          continue;
        }
        const stats = directoryStats(project);
        if (stats === undefined) {
          // The filesystem is the authority over what exists, so a path that is gone is forgotten
          // here rather than offered as a row no request can use.
          book.delete(project);
          continue;
        }
        rows.set(project, Number(stats.mtimeMs));
      }
    }
    return [...rows.entries()]
      .map(([path, modifiedMs]) => ({ path, modifiedMs }))
      .sort((left, right) => right.modifiedMs - left.modifiedMs || byPath(left.path, right.path));
  }

  return {
    list() {
      // A flag names a directory the same way a walk result does, so one that is gone drops out too.
      const existing = flags.filter((project) => directoryStats(project) !== undefined);
      flags.length = 0;
      flags.push(...existing);
      return [...flags, ...derived().map((row) => row.path)];
    },
    has: served,
    require(project) {
      if (!served(project)) {
        throw new ProtocolError(
          ProtocolErrorCode.UnknownProject,
          `this server does not serve the Project ${JSON.stringify(project)}`,
          project,
        );
      }
      return project;
    },
    register(project) {
      created.add(project);
    },
    discover(found) {
      walked.clear();
      for (const project of found) {
        walked.add(project);
      }
    },
  };
}
