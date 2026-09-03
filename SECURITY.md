# Security Policy

Please report vulnerabilities privately. Do not open a public GitHub issue for a security bug.

Use GitHub Security Advisories:

https://github.com/leozhengliu-pixel/agent-chrome/security/advisories/new

## Secrets

This project talks to the user's signed-in Chrome. Treat these as secrets and never commit, paste, or log them:

- Linux: ~/.config/agent-chrome/token
- macOS: ~/Library/Application Support/agent-chrome/token
- Windows: %APPDATA%/agent-chrome/token

The token file is created mode 0600 in a 0700 config directory. If the file is group/other-readable and cannot be repaired with chmod, the bridge refuses to use it.

The bridge also stores a port file (`bridge-port`) and a pid-proof file (`bridge.proof`, mode 0600) next to the token. On macOS/Linux it prefers a Unix socket `bridge.sock` (mode 0600) for the native host WebSocket and local RPC.

## Local authentication

- HTTP and WebSocket access require an `Authorization: Bearer` header. Query-string tokens (`?token=`) are rejected.
- Token comparison uses `crypto.timingSafeEqual`.
- `/health` is token-gated.
- `/host` WebSocket upgrades reject a present `Origin` that is not null/empty/localhost-ish. Random web origins are not allowed.
- The native host and a second MCP process **do not send the token** to whoever occupies port 19831. After a successful listen the bridge writes `bridge.proof` (pid + start secret, mode 0600). On `EADDRINUSE` (and before the host connects with the token) the proof file must exist, not be other-readable, name a live pid, and that pid's uid must match this process. Otherwise the client fails closed: the port is treated as taken by a stranger.

## Bind address

The bridge defaults to `127.0.0.1`. Binding a non-loopback address (`0.0.0.0`, a LAN IP, etc.) is refused unless `AGENT_CHROME_ALLOW_NON_LOOPBACK=1` is also set. That flag is a footgun: it exposes the token-gated HTTP API beyond this machine.

## Site policy

- Public `http:` / `https:` sites are default-allow.
- Loopback, RFC1918, link-local, and cloud-metadata addresses (including `169.254.169.254` and `fd00:ec2::254`) are denied.
- `file:`, `javascript:`, `data:`, and `ftp:` are denied.
- `chrome:`, `chrome-extension:` (other than this extension), `devtools:`, and similar internal URLs are **not** default-allow. Tight allowlist: `about:blank` and this extension's own origin. `chrome://extensions` is not auto-proceed.
- `tabs_list` omits denied URLs (no title/URL leak). `tab_focus` and `tabs_close` use the same allow check as snapshot/click.

## What is not a secret

extension/key.pem pins the unpacked extension ID (pikkhapdmpoooagfjiogpjaleapphnmh) and is committed on purpose so clones get a stable ID. Rotating it changes the ID and breaks native-host allowed_origins. Do not treat that PEM as a confidential credential; do not file a leaked-key report solely because it is in the tree.

## Scope notes

- The native host and bridge bind to localhost only (see Bind address).
- Interactive tools can drive the user's real Chrome profile. Isolation is only the default `tabs_open` tab group; later tools can target any tab in the profile. Please report bugs that would let a remote page or untrusted snapshot content escalate into host or MCP control.
- JavaScript evaluation (eval_js) is not part of v1 and should not be added without a security review.
- The native-host installer refuses to install if the wrapper, host JS, or wrapper directory is writable by others (or not owned by the current uid on unix). `allowed_origins` stays pinned to the extension ID. Windows uses HKCU.
