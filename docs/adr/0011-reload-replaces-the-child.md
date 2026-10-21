# Reloading configuration replaces the Pi child

Status: accepted.

`/reload` in pi-my-ui stops the Session's Pi child and starts another on the same Session file. It does not call pi's own in-process reload, which is what pi's TUI command does and what pi exposes to an extension command as `ctx.reload()`.

The reason is that this server, not pi, owns each Session's view of itself. The Projection, the Cursor and the browser's place in the transcript are server state; a browser that drops and returns is already reattached from the Session file without losing its place. So an in-process reload preserves nothing the app can observe, while a new process is defined by having read the configuration — every file pi reads at startup, with no second, narrower list to keep in step.

pi's in-process reload is also not atomic. It invalidates the old extension runtime before it builds the new one, so a resource that fails to load leaves the live session half-swapped and the process is the only way back. Replacing the child makes a failed reload a failed start: loud, and retryable once the broken file is fixed.

The rejected alternative was the smaller hammer: register a command from the Bridge that calls `ctx.reload()`, invoke it as a prompt, and confirm it afterwards. It is faster by roughly three orders of magnitude, and it keeps the process. It also needs a second way for the server to reach pi, a way to hide that command from the palette, and a truthful completion signal that pi's command path does not give — a handler that throws is still reported as handled, and the error that describes it is an event the Projection ignores. Three pieces of machinery to reach a reload that preserves nothing here.

Consequence: a reload costs a process start — 862 ms measured on the reference machine — and reseeds the Session, so every viewer of that Session receives a new Snapshot and a new Cursor. It also means a reload destroys more than an in-process one would, so it is refused while a direct shell command runs: the command dies with the process, and its partial output lives only in the live Projection, never in the Session file.
