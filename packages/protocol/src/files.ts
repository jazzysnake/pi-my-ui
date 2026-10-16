/**
 * The file-surface contract the client and the server must agree on: the download route, the entry
 * shape a listing returns, and the MIME/preview rules.
 *
 * Both runtimes speak this surface — the browser builds a download URL and decides which rows offer
 * a preview, the server serves the bytes and chooses the content type — and neither may import the
 * other, so a copy in each would drift silently. This module is the one definition of those shared
 * facts.
 */

import { FileEntryType } from "./constants.js";

/** The download route, relative to the server origin. */
export const FILE_DOWNLOAD_PATH = "/files/download";

/** Query parameter carrying the requested path, relative to the session working directory. */
export const FILE_PATH_PARAM = "path";

/**
 * Most bytes of a text-like file a preview renders.
 *
 * A phone viewport fits roughly one screen per 2 KB of body text, so this is many screens: enough to
 * recognise a source file or a document, small enough that a preview never becomes a download.
 */
export const PREVIEW_MAX_BYTES = 64 * 1024;

/** One directory entry, as a listing reports it. */
export interface DirectoryEntry {
  readonly name: string;
  readonly type: FileEntryType;
  /**
   * The entry's own size in bytes, or `null` when it could not be examined. A symlink reports the
   * link's size, never its target's, because the target may live outside the served root.
   */
  readonly size: number | null;
  /** The entry's own modification time in epoch milliseconds, or `null` when it could not be read. */
  readonly mtimeMs: number | null;
}

/** The content type reported when a name's extension is unknown or absent. */
export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** The content type a preview is rendered with: text, never a type the browser would execute. */
export const PREVIEW_CONTENT_TYPE = "text/plain; charset=utf-8";

/** Content types by lowercase extension (without the dot); an unlisted one falls back to the default. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  text: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  rst: "text/x-rst; charset=utf-8",
  adoc: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  ini: "text/plain; charset=utf-8",
  cfg: "text/plain; charset=utf-8",
  conf: "text/plain; charset=utf-8",
  env: "text/plain; charset=utf-8",
  ts: "text/typescript; charset=utf-8",
  tsx: "text/typescript; charset=utf-8",
  mts: "text/typescript; charset=utf-8",
  cts: "text/typescript; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  jsx: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  jsonc: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  py: "text/x-python; charset=utf-8",
  rb: "text/x-ruby; charset=utf-8",
  go: "text/x-go; charset=utf-8",
  rs: "text/x-rust; charset=utf-8",
  java: "text/x-java; charset=utf-8",
  kt: "text/x-kotlin; charset=utf-8",
  c: "text/x-c; charset=utf-8",
  h: "text/x-c; charset=utf-8",
  cc: "text/x-c++; charset=utf-8",
  cpp: "text/x-c++; charset=utf-8",
  hpp: "text/x-c++; charset=utf-8",
  cs: "text/x-csharp; charset=utf-8",
  php: "text/x-php; charset=utf-8",
  swift: "text/x-swift; charset=utf-8",
  scala: "text/x-scala; charset=utf-8",
  lua: "text/x-lua; charset=utf-8",
  pl: "text/x-perl; charset=utf-8",
  r: "text/x-rsrc; charset=utf-8",
  sql: "text/x-sql; charset=utf-8",
  graphql: "text/plain; charset=utf-8",
  gql: "text/plain; charset=utf-8",
  proto: "text/plain; charset=utf-8",
  sh: "text/x-shellscript; charset=utf-8",
  bash: "text/x-shellscript; charset=utf-8",
  zsh: "text/x-shellscript; charset=utf-8",
  fish: "text/x-shellscript; charset=utf-8",
  bat: "text/plain; charset=utf-8",
  cmd: "text/plain; charset=utf-8",
  ps1: "text/plain; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  yml: "application/yaml; charset=utf-8",
  toml: "application/toml; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  scss: "text/x-scss; charset=utf-8",
  less: "text/x-less; charset=utf-8",
  vue: "text/plain; charset=utf-8",
  svelte: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  tgz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  pdf: "application/pdf",
};

/**
 * The non-`text/*` content types a preview may render. `image/svg+xml` is deliberately absent: it is
 * an image, so the tree offers it as a download. HTML is previewable, but the preview always answers
 * `text/plain` with `nosniff`, so the browser shows its source rather than executing it.
 */
const PREVIEWABLE_APPLICATION_TYPES: ReadonlySet<string> = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/toml",
]);

/** The lowercase extension of a file name, without the dot (`""` when it has none). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    // No dot, a leading dot (`.gitignore` is all name), or a trailing dot: no extension.
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

/** The MIME type for a file name, by extension; {@link DEFAULT_CONTENT_TYPE} when unknown. */
export function contentTypeForName(name: string): string {
  return CONTENT_TYPES[fileExtension(name)] ?? DEFAULT_CONTENT_TYPE;
}

/** True when a content type is text-like, so a preview renders it (a `charset` is ignored). */
export function isPreviewableContentType(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base.startsWith("text/") || PREVIEWABLE_APPLICATION_TYPES.has(base);
}

/** True when a file name is text-like, so the tree offers a preview for it. */
export function isPreviewableName(name: string): boolean {
  return isPreviewableContentType(contentTypeForName(name));
}
