/**
 * The one Project-label rule: the last path segment, with parent segments prepended until two served
 * Projects differ. A server stores no display name, and a bare last segment would make `~/work/api`
 * and `~/oss/api` the same row, so the label is derived from the served list instead.
 */

function segmentsOf(project: string): readonly string[] {
  const segments = project.split(/[\\/]+/u).filter((segment) => segment !== "");
  return segments.length === 0 ? [project] : segments;
}

function suffix(segments: readonly string[], depth: number): string {
  return segments.slice(Math.max(0, segments.length - depth)).join("/");
}

/** One label per served Project, keyed by its absolute path. */
export function projectLabels(projects: readonly string[]): ReadonlyMap<string, string> {
  const segmented = projects.map((project) => segmentsOf(project));
  const labels = new Map<string, string>();

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    const segments = segmented[index];
    if (project === undefined || segments === undefined) {
      continue;
    }

    let depth = 1;
    while (depth < segments.length) {
      const candidate = suffix(segments, depth);
      const collides = segmented.some(
        (other, otherIndex) =>
          otherIndex !== index && suffix(other, depth) === candidate && other.length >= depth,
      );
      if (!collides) {
        break;
      }
      depth += 1;
    }
    labels.set(project, suffix(segments, depth));
  }

  return labels;
}

/**
 * The label a row shows for `project`. A Project reaches the drawer before the served list does (the
 * drawer can name the chosen path alone), so a path the map has no entry for is labelled by itself
 * rather than left blank.
 */
export function projectLabeler(projects: readonly string[]): (project: string) => string {
  const labels = projectLabels(projects);
  return (project) => labels.get(project) ?? project;
}
