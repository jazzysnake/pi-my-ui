/**
 * The Projects one running server serves, fixed when the server starts. Nothing adds, removes or
 * reorders a Project at runtime: the launcher's flags are the whole allowlist.
 */

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

export interface ProjectRegistry {
  /** Absolute paths, in the order the launcher was given them. */
  readonly projects: readonly string[];
  /**
   * The first served Project. File requests that do not yet carry a Project resolve against it;
   * Session requests name their Project explicitly and never fall back.
   */
  readonly primary: string;
  has(project: string): boolean;
  /** The Project as served, or a typed refusal for a path outside the registry. */
  require(project: string): string;
}

export function createProjectRegistry(projects: readonly string[]): ProjectRegistry {
  const served = new Set(projects);
  return {
    projects: Object.freeze([...projects]),
    primary: primaryProject(projects),
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

/**
 * The first served Project, which requests that do not name a Project resolve against. A server
 * with no Project has nowhere to run a Pi child, so it is refused rather than defaulted.
 */
export function primaryProject(projects: readonly string[]): string {
  const [primary] = projects;
  if (primary === undefined) {
    throw new Error("a server needs at least one Project to serve");
  }
  return primary;
}
