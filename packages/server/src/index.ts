/** The backend that owns the Session pool and serves Projections over its WebSocket. */

export { systemClock, type ServerClock } from "./clock.js";
export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  type BridgeOptions,
  type PiLaunchOptions,
  type ServerConfig,
} from "./config.js";
export {
  BRIDGE_EXTENSION_SPECIFIER,
  resolveBridgeExtensionEntry,
  withBridgeLaunch,
  type BridgeLaunchTarget,
} from "./bridge/launch.js";
export {
  BRIDGE_HELLO_TIMEOUT_MS,
  BRIDGE_MAX_FRAME_CHARS,
  DEFAULT_BRIDGE_CONNECT_TIMEOUT_MS,
  startBridgeListener,
  type BridgeListener,
  type BridgeListenerOptions,
} from "./bridge/listener.js";
export {
  BRIDGE_SOCKET_DIR_MODE,
  BRIDGE_SOCKET_MODE,
  BRIDGE_STALE_SOCKET_PROBE_TIMEOUT_MS,
  bindAndSecureSocket,
  removeBridgeSocket,
} from "./bridge/socket.js";
export {
  BRIDGE_RUNTIME_DIR_PREFIX,
  BRIDGE_SOCKET_FILENAME,
  bridgeSocketPath,
  XDG_RUNTIME_DIR,
} from "./bridge/socket-path.js";
export {
  BridgeConfigurationError,
  BridgeConnectionError,
  BridgeError,
  BridgeSocketError,
} from "./bridge/errors.js";
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
export {
  createSessionHost,
  type BridgeGate,
  type SessionHost,
  type SessionViewer,
} from "./session-host.js";
export { createSessionPool, type SessionPool, type SessionPoolBridge } from "./session-pool.js";
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
