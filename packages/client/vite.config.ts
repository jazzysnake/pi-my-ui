/**
 * The Vite client build and its dev-only proxy to the real backend.
 *
 * The backend serves no UI at all: its whole HTTP surface is `GET /healthz` and the WebSocket
 * upgrade. In production a static host serves the bundle and proxies those routes; locally,
 * `vite dev` serves the module graph and this proxy forwards the two routes to the backend so the
 * browser reaches real pi. `ws: true` on `/ws` is load-bearing: without it Vite answers the upgrade
 * itself and the app never connects.
 */

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** The WebSocket route the client opens (`WS_PATH` in `src/lib/config.ts`), repeated here as a literal. */
const WS_PATH = "/ws";
/** The backend health route, repeated here as a literal. */
const HEALTHZ_PATH = "/healthz";

/** Names the backend origin the dev proxy forwards to. */
export const BACKEND_ORIGIN_ENV_VAR = "PI_MY_UI_BACKEND_ORIGIN";
/** The launcher's default `--port`, so the default needs no configuration. */
export const DEFAULT_BACKEND_ORIGIN = "http://127.0.0.1:8787";

const PROXY_BACKEND_PROTOCOLS = ["http:", "https:"] as const;

/**
 * Resolve and validate the backend origin. Unset means the default; a set-but-unusable value throws
 * rather than silently proxying somewhere else.
 */
export function resolveBackendOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env[BACKEND_ORIGIN_ENV_VAR];
  if (configured === undefined) {
    return DEFAULT_BACKEND_ORIGIN;
  }
  if (configured.trim() === "") {
    throw new Error(
      `${BACKEND_ORIGIN_ENV_VAR} is set but empty; unset it to use ${DEFAULT_BACKEND_ORIGIN}`,
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      `${BACKEND_ORIGIN_ENV_VAR} is not an absolute URL: ${configured} (expected e.g. ${DEFAULT_BACKEND_ORIGIN})`,
    );
  }
  if (!PROXY_BACKEND_PROTOCOLS.some((protocol) => protocol === url.protocol)) {
    throw new Error(
      `${BACKEND_ORIGIN_ENV_VAR} must be an http or https origin: ${configured} (got ${url.protocol})`,
    );
  }
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      `${BACKEND_ORIGIN_ENV_VAR} must be a bare origin without a path, query, fragment, or credentials: ${configured}`,
    );
  }
  return url.origin;
}

const backendOrigin = resolveBackendOrigin(process.env);

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      [WS_PATH]: { target: backendOrigin, ws: true },
      [HEALTHZ_PATH]: { target: backendOrigin },
    },
  },
});
