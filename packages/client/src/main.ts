import { mount } from "svelte";

import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("index.html must provide a #app mount target");
}

mount(App, { target });
