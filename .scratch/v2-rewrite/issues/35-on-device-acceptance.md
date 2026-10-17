# 35: On-device acceptance (owner)

**What to build:** The owner runs the on-phone checklist over Tailscale and Caddy: iOS keyboard occlusion and safe areas, real latency, the TLS certificate, and the whole Caddy hop. Failures are filed as findings, not worked around.

**Blocked by:** All tickets 01–34

**Status:** ready-for-human

- [ ] Checklist written from the user guide
- [ ] Owner runs it on a real phone and records results
- [x] Each failure filed as a ticket

## Comments

Sweep 1 (visual pass over the shell, composer and tree) filed six findings, evidence in
`acceptance-1/`:

- 36 Most icons are missing, and the ones left are off-style
- 37 The connect dot and the Files icon are in each other's place
- 38 The composer's model, effort and auto-compact controls lost their colour
- 39 An open model or effort list does not close when you tap away
- 40 Walking back along an abandoned branch takes one tap per message
- 41 The agent pill sits in the header; the owner wants it where the session state was

Not filed, noticed in the same pass: v1's tree rows carry a timestamp per row and a
`Current leaf: <id>` line under the title, both absent here. `TreeEntry`
(`packages/protocol/src/tree.ts`) has no timestamp, so that one needs a protocol change before it can
be a UI ticket.
