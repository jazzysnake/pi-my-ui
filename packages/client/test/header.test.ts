import { describe, expect, it } from "vitest";

import { ClientStore } from "../src/lib/store/client-store.svelte.js";
import { mountShell } from "./composer-harness.js";

/**
 * The header's end group: the connection status leads and Files closes the row, because Files is the
 * control the header's trailing padding has to keep clear of the right safe area.
 */
describe("the header's end group", () => {
  it("puts the connection status before the Files toggle, with Files last", () => {
    const { target } = mountShell(new ClientStore());
    const bar = target.querySelector('[data-testid="top-bar"]');
    const status = bar?.querySelector('[data-testid="connection-status"]');
    const files = bar?.querySelector('[data-testid="files-toggle"]');
    if (bar === null || status == null || files == null) {
      throw new Error("the header is missing its connection status or its Files toggle");
    }

    expect(
      status.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the connection status must come before the Files toggle",
    ).toBeTruthy();

    const controls = [...bar.querySelectorAll('button, [data-testid="connection-status"]')];
    expect(controls.at(-1), "Files must be the header's last control").toBe(files);
  });
});
