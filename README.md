# Agent Chrome

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-chrome)](https://www.npmjs.com/package/agent-chrome)

**English** | [中文](README.zh-CN.md)

Generic Chrome MV3 extension plus a local bridge so any coding agent (Cursor, Claude Code, or a stdio MCP client) can drive the user's signed-in Chrome.

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

Bins: `agent-chrome` (bridge), `agent-chrome-host`, `agent-chrome-install-host`, `agent-chrome-install-extension`, `agent-chrome-setup`.

`agent-chrome-install-host` also runs the extension install guide: it copies the absolute `extension/` path to the clipboard and opens the extensions page (unless the pinned ID is already detected, or you set `AGENT_CHROME_SKIP_EXTENSION_INSTALL=1` / `--skip-extension`). Rerun with `agent-chrome-install-extension`. Combined: `agent-chrome-setup`.

### 2. Load the unpacked extension (human residual step)

Silent full auto-install is not possible on branded Google Chrome. After the host installer (or `agent-chrome-install-extension`) opens the extensions page and copies the path:

1. Enable Developer mode (top-right).
2. Click **Load unpacked** and select/paste the folder that contains `manifest.json` (clipboard already has the absolute path):
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

After a global install you can also run `agent-chrome --mcp`. The process binds `127.0.0.1:19831`. If another **proven** Agent Chrome bridge already owns that port (pid-proof file in the config dir), MCP attaches to it. A stranger occupying the port does not receive the auth token. Bind a non-loopback address only with `AGENT_CHROME_ALLOW_NON_LOOPBACK=1` (a footgun; see SECURITY.md).

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
3. **bridge/** — HTTP + WebSocket on `127.0.0.1:19831` (Bearer token in the user config dir; Unix socket `bridge.sock` preferred on macOS/Linux) and an MCP stdio server named `agent-chrome`.

The installer (`npm run install-host` / `node scripts/install-native-host.js`) writes `com.agentchrome.host.json` for Chrome, Chromium, and Edge on macOS, Linux, and Windows (HKCU). `allowed_origins` is `chrome-extension://pikkhapdmpoooagfjiogpjaleapphnmh/`. Compile TypeScript so `dist/` exists before installing the host.

Token file (created on first bridge start; treat as a secret):

- Linux: `~/.config/agent-chrome/token`
- macOS: `~/Library/Application Support/agent-chrome/token`
- Windows: `%APPDATA%/agent-chrome/token`

## Site policy

Public HTTP(S) sites are allowed by default. Chrome already asked for host access when the extension was loaded. There is no per-site confirmation popup for those sites.

Loopback, RFC1918, link-local, and cloud-metadata addresses are denied. `file:`, `javascript:`, `data:`, and `ftp:` are denied. `chrome://` / `devtools:` URLs are not auto-allowed (`about:blank` and this extension's own origin are). `chrome://extensions` is not default-proceed.

An explicit deny list in extension storage can still block a domain (hostname and eTLD+1, including `foo.github.io`). JavaScript evaluation (`eval_js`) is not available in v1.

## Tab isolation

`tabs_open` defaults to a background tab in an Agent Chrome tab group and does not steal the user's active tab. That group is **only** a default for the new tab. Later tools (`tabs_list`, `tab_focus`, `snapshot`, `click`, ...) are not bound to it and can target any tab in the signed-in profile (subject to site policy). Call `tab_focus` only when you must.

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
scripts/     install-native-host, install-extension, generate-icons
tests/       framing, allowlist, MCP schemas, mock loopback
skills/      agent skill (SKILL.md)
```

## Tests

```bash
npm test
```

No live Chrome is required. The loopback test speaks length-prefixed native messaging to the real host and bridge.

## Troubleshooting

- Popup Native host: offline — rerun `agent-chrome-install-host` (`npm run install-host`), confirm extension ID, reload the extension. If the extension is missing, run `agent-chrome-install-extension` and complete Load unpacked.
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
