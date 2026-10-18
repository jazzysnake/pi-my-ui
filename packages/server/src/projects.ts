/**
 * The Projects one running server serves, fixed when the server starts. Nothing adds, removes or
 * reorders a Project at runtime: the launcher's flags are the whole allowlist.
 */

export interface ProjectRegistry {
  /** Absolute paths, in the order the launcher was given them. */
  readonly projects: readonly string[];
  /**
   * The first served Project. Session and file requests that do not name a Project resolve against
   * it, which leaves a server serving one Project behaving exactly as it did before.
   */
  readonly primary: string;
}

export function createProjectRegistry(projects: readonly string[]): ProjectRegistry {
  return { projects: Object.freeze([...projects]), primary: primaryProject(projects) };
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
