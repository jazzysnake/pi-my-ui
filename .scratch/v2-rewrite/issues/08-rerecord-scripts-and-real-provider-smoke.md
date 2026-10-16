# 08: Re-record command and real-provider smoke

**What to build:** One command regenerates scripted-provider scripts from a real provider run so scripts cannot drift into fiction, and one opt-in smoke test runs against a real provider (outside the gate).

**Blocked by:** 06 Send a message and stream the reply

**Status:** ready-for-agent

- [ ] A single documented command re-records a named script from a real run
- [ ] The smoke test is skipped loudly without credentials and never part of verify
- [ ] Recorded scripts replay identically through the scripted provider
