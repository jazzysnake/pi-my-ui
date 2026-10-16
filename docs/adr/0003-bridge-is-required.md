# The bridge is required, not optional

Status: accepted. Supersedes v1 ADR 0008.

The bridge extension is loaded into every pi child and is the only channel that reaches past pi's RPC (subagent lifecycle, per-subagent transcripts, steering a specific subagent, moving the active leaf). If it fails to load or connect, the server fails loudly; there is no half-working degraded mode. The one graceful state kept is the `@tintinweb/pi-subagents` extension not being installed, in which case the subagent UI is absent.

v1's ADR 0008 specified layered degradation (full / without bridge / without extension) and the code implemented it, but the bridge was always loaded, so the middle tier was a second code path for a state that should be an error.
