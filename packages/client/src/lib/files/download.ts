/**
 * The client half of the download route. The route facts come from `@pi-my-ui/protocol`, and the URL
 * is derived from the transport URL so a dev or test page on another origin still reaches the backend.
 */

import { FILE_DOWNLOAD_PATH, FILE_PATH_PARAM } from "@pi-my-ui/protocol";

/** The absolute download URL for a path relative to the served root. */
export function fileDownloadUrl(transportUrl: string, path: string): string {
  const url = new URL(FILE_DOWNLOAD_PATH, transportUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.searchParams.set(FILE_PATH_PARAM, path);
  return url.toString();
}

/** Start a download through the browser's normal flow: a hidden POST form the browser navigates. */
export function startFileDownload(url: string): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = url;
  form.hidden = true;
  document.body.append(form);
  form.submit();
  form.remove();
}
