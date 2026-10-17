# The agent pill counts active subagents on `main`

Status: accepted. Supersedes v1 ADR 0012's agent-pill decision.

v1's pill read `main` while the main conversation was focused and only showed a count while a subagent was focused. That made background work invisible from the view the user spends most time in: a Session could have several agents running and the pill said just `main`.

The pill now shows `main +N` when the main conversation is focused, where N is the Session's queued and running subagents, and `@handle +N` when a subagent is focused, where N is the other active agents. The `@` marks the label as a subagent handle rather than another main state. A settled agent is not counted, so the count drops to nothing when the work ends. The pill is absent entirely while a Session has reported no agents, which is also how a Session without pi-subagents installed looks.

The count is derived from the subagent records in the Projection, never from a client guess, and it counts queued agents because a queued agent is work the user cannot see yet. A focused subagent is excluded from its own count.

Cost accepted: the pill is now a live element on the main view rather than a static label, so a background spawn changes the header's text while the user is reading the main conversation.
