# Agent Chrome

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-chrome)](https://www.npmjs.com/package/agent-chrome)

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

Install the public npm package, load the unpacked extension once, then point MCP at `agent-chrome --mcp`. There is no Chrome Web Store listing. Chrome 137+ ignores `--load-extension`; do not use `--remote-debugging-port`.

### 1. Install the local bridge and native host

```bash
npm install -g agent-chrome
agent-chrome-install-host
```

Bins: `agent-chrome` (bridge), `agent-chrome-host`, `agent-chrome-install-host`.

### 2. Load the unpacked extension

1. Open `chrome://extensions` and enable Developer mode.
2. Load unpacked and select the folder that contains `manifest.json`:
   - Global install: `$(npm root -g)/agent-chrome/extension`
   - Or unzip the GitHub Release asset [`agent-chrome-extension.zip`](https://github.com/leozhengliu-pixel/agent-chrome/releases/latest)
3. Confirm the ID is `pikkhapdmpoooagfjiogpjaleapphnmh` (public key in `manifest.json`; private key at `extension/key.pem`, committed on purpose to pin that ID).
4. Pin the toolbar icon. The popup shows native-host / bridge status, version, last error, and the MCP command.

Keep the unpacked extension enabled. If Chrome is closed, interactive tools automatically open Google Chrome with your signed-in profile (`Default`, or `AGENT_CHROME_PROFILE`) on macOS, Linux, and Windows, then wait for the native host to reconnect (~25s). Chrome restores previously loaded unpacked extensions, so Load unpacked is required once. `status` never launches Chrome.

Set `AGENT_CHROME_NO_LAUNCH=1` to disable auto-open. The launcher never uses `--headless`, `--remote-debugging-port`, or a temp user-data-dir.

### 3. Start MCP

```bash
npx -y agent-chrome --mcp
```

After a global install you can also run `agent-chrome --mcp`. The process binds `127.0.0.1:19831`. If another Agent Chrome bridge already owns that port, MCP attaches to it.

### Cursor `mcp.json`

```json
{
  "mcpServers": {
    "agent-chrome": {
      "command": "npx",
      "args": ["-y", "agent-chrome", "--mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add agent-chrome -- npx -y agent-chrome --mcp
```

### Generic stdio

```bash
npx -y agent-chrome --mcp
```

Protocol: JSON-RPC 2.0 NDJSON (`initialize`, `tools/list`, `tools/call`). Server name: `agent-chrome`.

Coding agents: start at [`skills/agent-chrome/SKILL.md`](skills/agent-chrome/SKILL.md).

### From source (optional)

```bash
git clone https://github.com/leozhengliu-pixel/agent-chrome.git
cd agent-chrome
npm install
npm test
npm run build
npm run install-host
```

Then load unpacked from `extension/` and start MCP with `npm run mcp` (`node dist/bridge/index.js --mcp`). `dist/` is gitignored, so build (or test) before installing the host. `npm run pack` writes `dist/agent-chrome-extension.zip` (`manifest.json` at the zip root, no `key.pem`).

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
