/**
 * The Projects one running server serves, fixed when the server starts. Nothing adds, removes or
 * reorders a Project at runtime: the launcher's flags are the whole allowlist.
 */

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

export interface ProjectRegistry {
  /** Absolute paths, in the order the launcher was given them. */
  readonly projects: readonly string[];
  has(project: string): boolean;
  /** The Project as served, or a typed refusal for a path outside the registry. */
  require(project: string): string;
}

/** No request may fall back to another Project, so a server with no Project is refused outright. */
export function createProjectRegistry(projects: readonly string[]): ProjectRegistry {
  if (projects.length === 0) {
    throw new Error("a server needs at least one Project to serve");
  }
  const served = new Set(projects);
  return {
    projects: Object.freeze([...projects]),
    has: (project) => served.has(project),
    require(project) {
      if (!served.has(project)) {
        throw new ProtocolError(
          ProtocolErrorCode.UnknownProject,
          `this server does not serve the Project ${JSON.stringify(project)}`,
          project,
        );
      }
      return project;
    },
  };
}
