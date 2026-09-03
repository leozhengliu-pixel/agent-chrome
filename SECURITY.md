# Security Policy

Please report vulnerabilities privately. Do not open a public GitHub issue for a security bug.

Use GitHub Security Advisories:

https://github.com/leozhengliu-pixel/agent-chrome/security/advisories/new

## Secrets

This project talks to the user's signed-in Chrome. Treat these as secrets and never commit, paste, or log them:

- Linux: ~/.config/agent-chrome/token
- macOS: ~/Library/Application Support/agent-chrome/token
- Windows: %APPDATA%/agent-chrome/token

The bridge also stores a port file next to the token (bridge-port). The token authenticates localhost HTTP/WebSocket access to the bridge.

## What is not a secret

extension/key.pem pins the unpacked extension ID (pikkhapdmpoooagfjiogpjaleapphnmh) and is committed on purpose so clones get a stable ID. Rotating it changes the ID and breaks native-host allowed_origins. Do not treat that PEM as a confidential credential; do not file a leaked-key report solely because it is in the tree.

## Scope notes

- The native host and bridge bind to localhost only.
- Interactive tools can drive the user's real Chrome profile. Please report bugs that would let a remote page or untrusted snapshot content escalate into host or MCP control.
- JavaScript evaluation (eval_js) is not part of v1 and should not be added without a security review.
