/**
 * Serves the built client the way Caddy does in production: static files from one origin. The
 * browser specs open this page and let its real transport reach the test server over its own
 * ephemeral port, so the browser exercises the real bundle, not a component harness.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIR = fileURLToPath(new URL("../../client/dist/", import.meta.url));

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

export interface ClientPageServer {
  readonly url: string;
  close(): Promise<void>;
}

async function serveFile(response: ServerResponse, root: string, pathname: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, normalize(relative));
  if (filePath !== root && !filePath.startsWith(`${root}/`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}

export async function startClientPageServer(): Promise<ClientPageServer> {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    throw new Error(`the client is not built at ${DIST_DIR}; run npm run build`);
  }
  const root = resolve(DIST_DIR);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    void serveFile(response, root, pathname);
  });

  await new Promise<void>((resolveStarted, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveStarted);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolveClosed, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolveClosed();
          }
        });
      }),
  };
}
