import { mount } from "svelte";

import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("index.html must provide a #app mount target");
}

// The row prototype is throwaway scaffolding: a search param selects it and the dev-only import lets
// the production bundle drop it instead of shipping a second entry point.
const wantsRowsPrototype = new URLSearchParams(window.location.search).get("prototype") === "rows";
if (import.meta.env.DEV && wantsRowsPrototype) {
  void import("./lib/prototype/PrototypeRows.svelte").then(({ default: PrototypeRows }) => {
    mount(PrototypeRows, { target });
  });
} else {
  mount(App, { target });
}
