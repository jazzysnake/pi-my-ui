/**
 * The two runtime producers of Projects beside the launch flags: the walk of the Workspace, and the
 * one directory a create makes. Neither runs a version-control command, because `.git` is only what
 * discovery looks for and choosing a repository is the user's next move.
 */

import { lstat, mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import ignore, { type Ignore } from "ignore";

import { ProtocolError, ProtocolErrorCode } from "@pi-my-ui/protocol";

import type { ProjectRegistry } from "./projects.js";

/**
 * The one marker that makes a directory a discovered Project; a worktree or submodule records it as a
 * file rather than a directory. The walk stats this entry instead of running git, because a spawn per
 * candidate directory would make a walk over a real Workspace unusably slow.
 */
const GIT_ENTRY = ".git";

/**
 * Directory names no Workspace wants walked: an installed package tree, and Python's bytecode cache.
 * The second earned its place by measurement — on a real 37-Project Workspace it was 2,602 of the
 * 13,343 directories visited, and nothing in the tree excluded it.
 */
const PRUNED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(["node_modules", "__pycache__"]);

const GITIGNORE_ENTRY = ".gitignore";

/**
 * Rules kept beside the directory they are written against, so a pattern from an ancestor still reads
 * the same way one level down.
 */
interface IgnoreRules {
  readonly directory: string;
  readonly matcher: Ignore;
}

interface Walk {
  readonly directory: string;
  /** Root first, so the deepest `.gitignore` is the last rule set consulted. */
  readonly rules: readonly IgnoreRules[];
}

/**
 * The rules one directory's `.gitignore` holds, or nothing when it has none or cannot be read or
 * parsed. Rules this process cannot read cost their own directory, never the list.
 */
async function readIgnoreRules(directory: string): Promise<IgnoreRules | undefined> {
  const lines = await readFile(join(directory, GITIGNORE_ENTRY), "utf8").catch(() => undefined);
  if (lines === undefined) {
    return undefined;
  }
  try {
    return { directory, matcher: ignore().add(lines) };
  } catch {
    return undefined;
  }
}

/**
 * Whether git would skip `directory`. Only `.gitignore` files inside the Workspace count: git's own
 * exclude files can sit anywhere on the machine, and reading them would make a Workspace's list depend
 * on how that machine is set up.
 */
function ignoresDirectory(rules: readonly IgnoreRules[], directory: string): boolean {
  // Deeper files override shallower ones: the first file with anything to say about the path decides.
  for (const rule of [...rules].reverse()) {
    const path = relative(rule.directory, directory);
    if (path === "") {
      continue;
    }
    const verdict = rule.matcher.test(`${path}/`);
    if (verdict.ignored) {
      return true;
    }
    if (verdict.unignored) {
      return false;
    }
  }
  return false;
}

async function holdsGitEntry(directory: string): Promise<boolean> {
  try {
    await stat(join(directory, GIT_ENTRY));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every Project in the Workspace. Dot-directories, `node_modules`, `__pycache__` and whatever an
 * in-repo `.gitignore` excludes are pruned, a symlinked directory is never entered, and there is no
 * depth cap: the prunes bound the walk, and a cap would silently hide a Project a few levels down.
 * Nested Projects are all served.
 */
export async function discoverProjects(workspace: string): Promise<readonly string[]> {
  const realWorkspace = await realpath(workspace);
  const found: string[] = [];
  const pending: Walk[] = [{ directory: realWorkspace, rules: [] }];
  while (pending.length > 0) {
    const { directory, rules } = pending.pop() as Walk;
    if (await holdsGitEntry(directory)) {
      found.push(directory);
    }
    // One unreadable or vanished directory must not fail the whole list: the walk answers the
    // Projects it could see rather than leaving the client with no answer at all.
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const ownRules = await readIgnoreRules(directory);
    const rulesBelow = ownRules === undefined ? rules : [...rules, ownRules];
    // `withFileTypes` answers from the directory entry itself, so a symlink is not a directory here
    // and is never followed.
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        PRUNED_DIRECTORY_NAMES.has(entry.name)
      ) {
        continue;
      }
      // A directory git ignores is pruned rather than entered, which is also why a later negation
      // can only re-include a directory, never something beneath one already skipped.
      const child = join(directory, entry.name);
      if (ignoresDirectory(rulesBelow, child)) {
        continue;
      }
      pending.push({ directory: child, rules: rulesBelow });
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
