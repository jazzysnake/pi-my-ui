/**
 * The one path-safety helper every filesystem read uses, so the traversal rule exists once: a path
 * that escapes the root — absolute, lexical `..`, or a symlink out — is a typed refusal. The lexical
 * check runs before `realpath`, so the obvious refusals never touch the disk.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { errorText } from "../error-text.js";
import { isNotFoundError, PathEscapeError, PathNotFoundError } from "./errors.js";

/** A request that passed path safety, resolved against the served root. */
export interface ResolvedPath {
  /** The caller's path, verbatim, so an answer can echo what was asked for. */
  readonly requested: string;
  /** The normalized path relative to the root; `""` is the root itself. */
  readonly relative: string;
  /** The realpath'd absolute target. */
  readonly absolute: string;
  /** The realpath'd root. */
  readonly root: string;
}

/** True when a path computed relative to the root points above it. */
function escapes(rootRelative: string): boolean {
  return rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative);
}

/** The lexical half: reject an absolute path or a `..` traversal, with no I/O. */
export function resolveRelativePath(root: string, requested: string): string {
  if (requested.includes("\0")) {
    throw new PathEscapeError(requested, "contains a NUL byte");
  }
  if (isAbsolute(requested)) {
    throw new PathEscapeError(requested, "is an absolute path");
  }
  const rel = relative(root, resolve(root, requested));
  if (escapes(rel)) {
    throw new PathEscapeError(requested, "resolves outside the served working directory");
  }
  return rel;
}

/**
 * Resolve one request against the served root: the lexical check, then a `realpath` of the target and
 * a second containment check for symlink escapes. Throws a typed error; never returns a path outside
 * the root.
 */
export function resolvePath(root: string, requested: string): ResolvedPath {
  const rel = resolveRelativePath(root, requested);

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // The root is a server invariant; a root that cannot be resolved is a configuration failure,
    // reported as a typed refusal rather than a silent fallback.
    throw new PathNotFoundError(root);
  }

  const candidate = resolve(realRoot, rel);
  let absolute: string;
  try {
    absolute = realpathSync(candidate);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new PathNotFoundError(requested);
    }
    // A denial or any other failure is a refusal: the caller must never receive a path this helper
    // could not verify is inside the root.
    throw new PathEscapeError(requested, `could not be resolved: ${errorText(error)}`);
  }

  if (escapes(relative(realRoot, absolute))) {
    throw new PathEscapeError(requested, "a symlink resolves outside the served working directory");
  }

  return { requested, relative: rel, absolute, root: realRoot };
}
