/** `marked` parses assistant text; DOMPurify decides what of the result is safe to inject. */

import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
