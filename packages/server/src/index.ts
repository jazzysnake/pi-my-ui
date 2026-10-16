/** The backend that owns the Session pool and serves Projections over its WebSocket. */

export { DEFAULT_HOST, DEFAULT_PORT, type PiLaunchOptions, type ServerConfig } from "./config.js";
export { startServer, type RunningServer } from "./server.js";
export { createSessionHost, type SessionHost } from "./session-host.js";
export { createSessionPool, type SessionPool } from "./session-pool.js";
export { startPiChild, type PiChild, type PiEntries } from "./pi-child.js";
export { projectionBatch, type ProjectionSource } from "./projection.js";
