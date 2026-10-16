import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface PlaceholderPageServer {
  readonly url: string;
  close(): Promise<void>;
}

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>pi-my-ui</title>
  </head>
  <body>
    <main>
      <h1>pi-my-ui</h1>
      <p data-testid="layer">browser</p>
    </main>
  </body>
</html>
`;

/** Serves one static page on an ephemeral loopback port, so a browser test has somewhere to go. */
export async function startPlaceholderPageServer(): Promise<PlaceholderPageServer> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}
