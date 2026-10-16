# Real pi with a scripted model provider is the only oracle for pi behaviour

Status: accepted

All pi-facing behaviour is tested against real `pi`. Determinism comes from a scripted model provider extension, registered through pi's own custom-provider seam; its scripts are recorded from real provider runs, not hand-written, with a re-record command and one opt-in smoke test against a real provider. v2 has no fake of pi at any height: no mock server, no fake RPC child, no pool or child doubles.

v1 had a 3,255-line mock at the WebSocket seam that the e2e suite ran against, plus a 599-line fake at the process seam. Nothing kept them equal to pi or to each other, and they diverged (five recorded divergences; one passing review mechanism was inert against real pi). The scripted provider fakes only what is genuinely external and non-deterministic, the model's replies, at a seam pi itself documents. Cost accepted: the suite spawns real pi, so it is slower than a fake would be; if that proves too slow, a process-boundary fake may be added only with a conformance check against real pi.
