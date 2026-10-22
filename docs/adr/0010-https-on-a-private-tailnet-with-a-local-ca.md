# HTTPS on a private tailnet with a local CA

Status: accepted

The phone reaches `pi-my-ui` over a Headscale-coordinated tailnet, and the browser needs a
certificate it trusts. Caddy terminates TLS with **its own local CA** for the machine's MagicDNS
name, binds only the two tailnet addresses, and listens on nothing else; each device trusts Caddy's
root certificate once.

The obvious answer — let Tailscale issue the certificate — is unavailable, and not just for now.
Caddy's `.ts.net` integration only recognises Tailscale's own namespace, and a Headscale tailnet
names machines under a domain its operator owns, so the shortcut never fires. Headscale itself
gained `tailscale cert` and HTTPS `serve` support, but it issues node certificates through ACME
**DNS‑01**, which requires API credentials for the DNS provider behind that domain; this tailnet's
provider has no API, and buying one to serve a certificate for a private network is a poor trade.
A public certificate via DNS‑01 on a separate name fails for the same reason. That leaves a local CA
as the only path that needs neither a public DNS API nor unreleased coordination software.

Plain HTTP was the other real option, and it is not merely a weaker variant of HTTPS here: WireGuard
already encrypts the wire, so confidentiality is not the issue. What HTTP loses is the browser's
secure context, and the client uses exactly one thing that needs it —
`navigator.clipboard.writeText` in the copy controls, which throws on an insecure origin and is
swallowed by its own `catch`, so every copy control on the phone would silently do nothing. A
months-long wait for a certificate feature that then needs DNS plumbing is a bad exchange for that.

Consequences:

- The root certificate is durable state in the `caddy-data` volume. Recreating the volume mints a new
  root and every device must trust it again; the volume is not a cache to be cleared casually.
- Every device that opens the app needs the one-time trust step. This is browser-only: the
  certificate is for Chrome and Safari, not for apps with their own trust store.
- Caddy binds the tailnet addresses rather than the wildcard interface, in both address families.
  Making the app reachable is therefore a network-level act, not just an origin string: the LAN has
  no socket to reach, and a v4-only bind would have dropped the phone on an IPv6-preferring tailnet.
- No listener on `:80`, so a bare `http://` link fails instead of redirecting. The app's origin is
  `https://<MagicDNS name>` with no port, which is also the value the server's allowlist compares
  exactly.
- Migrating to a publicly trusted certificate later is a two-line change (`tls internal` → nothing,
  certificates from elsewhere) with no change to the origin, the allowlist or any mount.
