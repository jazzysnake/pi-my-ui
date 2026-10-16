# 02: Real-pi harness with scripted provider

**What to build:** A test can start real `pi --mode rpc` in a hermetic home with the scripted-provider extension loaded, name a script, and get deterministic replies. Scripts are recorded assistant turns shaped like session-file turns, and may contain tool calls and subagent (`Agent`) calls. Real pi executes tool calls for real in the hermetic workspace; the model's decision is the only scripted part. A prompt the script does not expect fails loudly and is never improvised. No fake of pi exists anywhere (ADR 0002).

**Blocked by:** 01 Workspace skeleton and verify gate

**Status:** ready-for-agent

- [ ] A test sends a prompt to real pi and receives the scripted reply
- [ ] A scripted tool call is executed by real pi in the hermetic workspace and its real result is fed back
- [ ] An unexpected prompt fails the test loudly
- [ ] Each test gets its own hermetic pi home and port namespace; no access to the user's real ~/.pi
