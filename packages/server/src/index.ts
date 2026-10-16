/** The backend that owns the Session pool and serves Projections over its WebSocket. */

export { DEFAULT_HOST, DEFAULT_PORT, type PiLaunchOptions, type ServerConfig } from "./config.js";
export {
  HEALTHZ_PATH,
  HEALTHZ_SERVICE_NAME,
  ServerBindError,
  startServer,
  type RunningServer,
} from "./server.js";
export {
  ALLOWED_ORIGIN_FLAG,
  ALLOWED_ORIGIN_FLAG_NAME,
  OriginConfigurationError,
  allowedOriginError,
  createTrustPolicy,
  validateAllowedOrigin,
  type AllowedOriginRejection,
  type AllowedOriginValidation,
  type OriginRequest,
  type TrustDecision,
  type TrustPolicy,
} from "./origin.js";
export { isLoopbackAddress, isLoopbackHostname } from "./loopback.js";
export { createSessionHost, type SessionHost } from "./session-host.js";
export { createSessionPool, type SessionPool } from "./session-pool.js";
export { startPiChild, type PiChild, type PiEntries } from "./pi-child.js";
export { projectionBatch, type ProjectionSource } from "./projection.js";
export {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE_FAILURE,
  LOG_PREFIX,
  resolveLauncherConfig,
  runLauncher,
  type LauncherConfig,
  type LauncherIo,
  type LauncherSignals,
  type RunLauncherOptions,
} from "./launcher/run.js";
export {
  parseLauncherArgs,
  type LauncherArguments,
  type ParsedLauncherArgs,
} from "./launcher/args.js";
export { LAUNCHER_COMMAND_NAME, LAUNCHER_USAGE, SHUTDOWN_SIGNALS } from "./launcher/flags.js";
export {
  LauncherArgumentError,
  LauncherBindError,
  LauncherConfigurationError,
  LauncherError,
} from "./launcher/errors.js";
