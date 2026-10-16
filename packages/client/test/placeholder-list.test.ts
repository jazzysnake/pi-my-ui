import { flushSync, mount } from "svelte";
import { describe, expect, it } from "vitest";

import PlaceholderList from "../src/lib/PlaceholderList.svelte";

describe("PlaceholderList", () => {
  it("renders every item it is given as plain data", () => {
    const target = document.createElement("div");
    document.body.append(target);

    flushSync(() => {
      mount(PlaceholderList, { target, props: { items: ["alpha", "beta"] } });
    });

    const rendered = [...target.querySelectorAll("li")].map((item) => item.textContent);
    expect(rendered).toEqual(["alpha", "beta"]);
  });
});
