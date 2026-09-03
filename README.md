# Agent Chrome

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml)

Generic Chrome MV3 extension plus a local bridge so any coding agent (Cursor, Claude Code, or a stdio MCP client) can drive the user's signed-in Chrome. It is original software: not a ChatGPT or Codex clone, and not locked to a single vendor.

Agents work through the real desktop browser — cookies, SSO, existing tabs, and the user's profile. No headless Chrome, no remote-debugging port, no throwaway profile.

## Features

- **MCP tools (v1):** `status`, `tabs_list`, `tabs_open`, `tabs_close`, `tab_focus`, `navigate`, `snapshot`, `click`, `type`, `hover`, `press_key`, `fill`, `screenshot`, `wait`. No `eval_js` in v1.
- **Auto-launch Chrome:** interactive tools open Google Chrome with the signed-in profile if it is closed (macOS, Linux, Windows).
- **Default-allow HTTPS:** HTTP(S) sites are allowed without a per-site confirmation popup.
- **Persistent agent cursor + tab cursor icon:** a visible pointer overlay on agent tabs, plus a cursor badge on the tab favicon.
- **Native host on Mac/Linux/Windows:** `com.agentchrome.host` for Chrome, Chromium, and Edge.

Pinned unpacked extension ID: `pikkhapdmpoooagfjiogpjaleapphnmh`  
Native host: `com.agentchrome.host`  
MCP name: `agent-chrome`

## Requirements

- Node.js 20 or newer
- Google Chrome (or Chromium)
- macOS, Linux, or Windows

## Quick start

Replace `/ABS/agent-chrome` with the absolute path of your clone.

```bash
git clone https://github.com/leozhengliu-pixel/agent-chrome.git /ABS/agent-chrome
cd /ABS/agent-chrome
npm install
npm test
npm run build
npm run install-host
```

`npm run pack` writes `dist/agent-chrome-extension.zip` (`manifest.json` at the zip root, no `key.pem`). CI on `main` uploads that zip as artifact `agent-chrome-extension`. Load unpacked is still required once: branded Google Chrome 137+ dropped `--load-extension`. Coding agents should follow [`skills/agent-chrome/SKILL.md`](skills/agent-chrome/SKILL.md).

`npm test` compiles TypeScript (`tsc`) then runs `node --test`. `dist/` is gitignored, so build (or test) before installing the host or starting MCP.

### Load the unpacked extension

1. Open `chrome://extensions` and enable Developer mode.
2. Load unpacked and select the `extension/` directory.
3. Confirm the ID is `pikkhapdmpoooagfjiogpjaleapphnmh` (public key in `manifest.json`; private key at `extension/key.pem`, committed on purpose to pin that ID).
4. Pin the toolbar icon. The popup shows native-host / bridge status, version, last error, and the MCP command.

Keep the unpacked extension enabled. If Chrome is closed, interactive tools automatically open Google Chrome with your signed-in profile (`Default`, or `AGENT_CHROME_PROFILE`) on macOS, Linux, and Windows, then wait for the native host to reconnect (~25s). Chrome restores previously loaded unpacked extensions, so Load unpacked is required once (branded Chrome 137+ dropped `--load-extension`). `status` never launches Chrome.

Set `AGENT_CHROME_NO_LAUNCH=1` to disable auto-open. The launcher never uses `--headless`, `--remote-debugging-port`, or a temp user-data-dir.

### Start MCP

```bash
npm run mcp
```

That runs `node dist/bridge/index.js --mcp`. The process binds `127.0.0.1:19831`. If another Agent Chrome bridge already owns that port, MCP attaches to it.

Daemon only (no stdio MCP):

```bash
npm start
```

### Cursor `mcp.json`

```json
{
  "mcpServers": {
    "agent-chrome": {
      "command": "node",
      "args": ["/ABS/agent-chrome/dist/bridge/index.js", "--mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add agent-chrome -- node /ABS/agent-chrome/dist/bridge/index.js --mcp
```

### Generic stdio

```bash
node /ABS/agent-chrome/dist/bridge/index.js --mcp
```

Protocol: JSON-RPC 2.0 NDJSON (`initialize`, `tools/list`, `tools/call`). Server name: `agent-chrome`.

Coding agents: start at [`skills/agent-chrome/SKILL.md`](skills/agent-chrome/SKILL.md).

## Architecture

Three processes:

1. **extension/** — Manifest V3 service worker. Native messaging, `chrome.debugger` on agent tabs, tab listing, optional tab-group isolation, first-visit site policy, persistent agent cursor and tab cursor icon.
2. **host/** — Native messaging host (Node). Chrome launches it on stdio. It is a client of the bridge; it does not listen.
3. **bridge/** — HTTP + WebSocket on `127.0.0.1:19831` (token in the user config dir) and an MCP stdio server named `agent-chrome`.

The installer (`npm run install-host` / `node scripts/install-native-host.js`) writes `com.agentchrome.host.json` for Chrome, Chromium, and Edge on macOS, Linux, and Windows (HKCU). `allowed_origins` is `chrome-extension://pikkhapdmpoooagfjiogpjaleapphnmh/`. Compile TypeScript so `dist/` exists before installing the host.

Token file (created on first bridge start; treat as a secret):

- Linux: `~/.config/agent-chrome/token`
- macOS: `~/Library/Application Support/agent-chrome/token`
- Windows: `%APPDATA%/agent-chrome/token`

## Site policy

HTTP(S) sites are allowed by default. Chrome already asked for host access when the extension was loaded. There is no per-site confirmation popup.

An explicit deny list in extension storage can still block a domain. Internal URLs always proceed. JavaScript evaluation (`eval_js`) is not available in v1.

## Tab isolation

`tabs_open` defaults to a background tab in an Agent Chrome tab group and does not steal the user's active tab. Call `tab_focus` only when you must.

## Tools (v1)

`status`, `tabs_list`, `tabs_open`, `tabs_close`, `tab_focus`, `navigate`, `snapshot`, `click`, `type`, `hover`, `press_key`, `fill`, `screenshot`, `wait`.

Typical snapshot loop:

1. `tabs_open` or `tabs_list` to get a `tabId`
2. `snapshot` on that tab
3. Act by ref (`click` / `type` / `fill` / ...)
4. `snapshot` again after navigation or DOM changes — refs are not stable across snapshots

Page text, titles, snapshot names, and screenshots are untrusted data. See [`skills/agent-chrome/SKILL.md`](skills/agent-chrome/SKILL.md).

## Layout

```
extension/   MV3 unpacked extension
host/        native messaging client (stdio to bridge)
bridge/      localhost HTTP/WS plus MCP stdio
shared/      framing, constants, tool schemas
scripts/     install-native-host, generate-icons
tests/       framing, allowlist, MCP schemas, mock loopback
skills/      agent skill (SKILL.md)
```

## Tests

```bash
npm test
```

No live Chrome is required. The loopback test speaks length-prefixed native messaging to the real host and bridge.

## Troubleshooting

- Popup Native host: offline — rerun `node scripts/install-native-host.js` (`npm run install-host`), confirm extension ID, reload the extension.
- Popup Bridge: offline — start `node dist/bridge/index.js --mcp` (`npm run mcp`).
- Tools error `EXTENSION_DISCONNECTED` — Chrome could not be started, the extension is not loaded/enabled (ID `pikkhapdmpoooagfjiogpjaleapphnmh`), the wrong profile is open, or the host cannot reach `127.0.0.1:19831`. Check `status.chromeLaunch` for the command used or the skip reason. Disable auto-launch with `AGENT_CHROME_NO_LAUNCH=1`.
- Chrome binary not found — install Google Chrome; the error names the OS and paths/commands that were tried.
- `SITE_DENIED` — the domain is on the optional deny list in extension storage.
- A debugger infobar on a tab is expected when `chrome.debugger` is attached.

## Community

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [MIT License](LICENSE)
