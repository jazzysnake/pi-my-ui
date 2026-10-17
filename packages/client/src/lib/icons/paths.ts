/**
 * The vendored Lucide icon set: the one source of glyph geometry for the whole client.
 *
 * The pack is vendored as **data** rather than installed as `lucide-svelte`: that package ships a
 * Svelte-4 legacy component per icon and costs a chunk of bundle for the first one, while
 * transcribed geometry costs a few hundred bytes for the set and cannot break under an upstream
 * major.
 *
 * Only the child elements Lucide uses here are modelled — `path`, `circle`, `rect` — so the renderer
 * needs no `{@html}` (the client has exactly one HTML sink, `SanitizedHtml.svelte`). Draw order does
 * not matter: every child is `fill="none"` with the same `stroke="currentColor"`, so grouping all
 * paths before all circles and rects paints the identical figure.
 *
 * ------------------------------------------------------------------------------------------------
 * ISC License
 *
 * Copyright (c) Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without
 * fee is hereby granted, provided that the above copyright notice and this permission notice appear
 * in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
 * SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
 * AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
 * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 *
 * The following Lucide icons are derived from the Feather project and carry the MIT terms below:
 * `chevron-down`, `chevron-right`, `square`, `terminal`, `arrow-up`, `x`.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
 * OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 * ------------------------------------------------------------------------------------------------
 */

/** A `<circle>` child, in the icon's 24×24 user space. */
export interface IconCircle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** A `<rect>` child, in the icon's 24×24 user space. Every Lucide rect here is rounded. */
export interface IconRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
}

/** One icon's children, grouped by element kind (see the note on draw order above). */
export interface IconGeometry {
  readonly paths?: readonly string[];
  readonly circles?: readonly IconCircle[];
  readonly rects?: readonly IconRect[];
}

/**
 * The vendored set, keyed by Lucide's own name. `as const satisfies` keeps every key and every value
 * literal while checking the shape, so `IconName` is the exact union of shipped names and a typo in
 * a call site fails `svelte-check`.
 */
export const ICONS = {
  menu: { paths: ["M4 5h16", "M4 12h16", "M4 19h16"] },
  folder: {
    paths: [
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ],
  },
  plus: { paths: ["M5 12h14", "M12 5v14"] },
  paperclip: {
    paths: [
      "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
    ],
  },
  "git-branch": {
    paths: ["M15 6a9 9 0 0 0-9 9V3"],
    circles: [
      { cx: 18, cy: 6, r: 3 },
      { cx: 6, cy: 18, r: 3 },
    ],
  },
  square: { rects: [{ x: 3, y: 3, width: 18, height: 18, rx: 2 }] },
  "arrow-up": { paths: ["m5 12 7-7 7 7", "M12 19V5"] },
  x: { paths: ["M18 6 6 18", "m6 6 12 12"] },
  diamond: {
    paths: [
      "M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z",
    ],
  },
  "chevron-right": { paths: ["m9 18 6-6-6-6"] },
  "chevron-down": { paths: ["m6 9 6 6 6-6"] },
  "git-fork": {
    paths: ["M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9", "M12 12v3"],
    circles: [
      { cx: 12, cy: 18, r: 3 },
      { cx: 6, cy: 6, r: 3 },
      { cx: 18, cy: 6, r: 3 },
    ],
  },
  copy: {
    paths: ["M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
    rects: [{ x: 8, y: 8, width: 14, height: 14, rx: 2 }],
  },
  check: { paths: ["M20 6 9 17l-5-5"] },
  dot: { circles: [{ cx: 12, cy: 12, r: 1 }] },
  user: {
    paths: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"],
    circles: [{ cx: 12, cy: 7, r: 4 }],
  },
  bot: {
    paths: ["M12 8V4H8", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2"],
    rects: [{ x: 4, y: 8, width: 16, height: 12, rx: 2 }],
  },
  hammer: {
    paths: [
      "m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9",
      "m18 15 4-4",
      "m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",
    ],
  },
  terminal: { paths: ["M12 19h8", "m4 17 6-6-6-6"] },
  "arrow-down-to-line": { paths: ["M12 17V3", "m6 11 6 6 6-6", "M19 21H5"] },
  layers: {
    paths: [
      "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
      "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
      "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
    ],
  },
  pencil: {
    paths: [
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      "m15 5 4 4",
    ],
  },
} as const satisfies Readonly<Record<string, IconGeometry>>;

/** Every vendored icon name — the union of the record's keys, so a typo fails the type check. */
export type IconName = keyof typeof ICONS;
