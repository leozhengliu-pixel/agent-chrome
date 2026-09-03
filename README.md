# Agent Chrome

Skill for coding agents: skills/agent-chrome/SKILL.md — start there if you are an agent.

Generic Chrome MV3 extension plus local bridge so any coding agent (Cursor, Claude Code, or a stdio MCP client) can drive the user's signed-in Chrome. It does not clone a ChatGPT side-chat, and it is not tied to a single vendor.

Three processes:

1. extension/ — Manifest V3 service worker. Native messaging, chrome.debugger on agent tabs, tab listing, optional tab-group isolation, first-visit site policy.
2. host/ — Native messaging host (Node). Chrome launches it on stdio. It is a client of the bridge; it does not listen.
3. bridge/ — HTTP + WebSocket on 127.0.0.1:19831 (token in the user config dir) and an MCP stdio server named agent-chrome.

Pinned unpacked extension ID: pikkhapdmpoooagfjiogpjaleapphnmh
Native host name: com.agentchrome.host
MCP server name: agent-chrome

## Install

Requires Node.js 20+ and Google Chrome (or Chromium).

Clone this repository, install Node dependencies, run the test suite, then:

    node scripts/install-native-host.js

The installer writes com.agentchrome.host.json for Chrome, Chromium, and Edge on macOS, Linux, and Windows (HKCU). allowed_origins is chrome-extension://pikkhapdmpoooagfjiogpjaleapphnmh/. Compile TypeScript so dist/ exists before installing the host.

Token file (created on first bridge start):

- Linux: ~/.config/agent-chrome/token
- macOS: ~/Library/Application Support/agent-chrome/token
- Windows: %APPDATA%/agent-chrome/token

## Load unpacked

1. Open the Chrome extensions page (developer mode).
2. Load unpacked and select this repo extension/ directory.
3. Confirm the ID is pikkhapdmpoooagfjiogpjaleapphnmh (public key in manifest.json; private key at extension/key.pem).
4. Pin the toolbar icon. The popup shows native-host / bridge status, version, last error, and the MCP command.

Keep the unpacked extension enabled. If Chrome is closed, interactive tools (tabs, snapshot, click, …) automatically open Google Chrome with your signed-in profile (Default, or `AGENT_CHROME_PROFILE`) on macOS, Linux, and Windows, then wait for the native host to reconnect (~25s). Chrome restores previously loaded unpacked extensions, so the extension must already have been loaded once. `status` never launches Chrome.

Set `AGENT_CHROME_NO_LAUNCH=1` to disable auto-open. The launcher never uses `--headless`, `--remote-debugging-port`, or a temp user-data-dir.

## Start the bridge and MCP

The MCP process binds 127.0.0.1:19831. If that port is already taken by another Agent Chrome bridge, MCP attaches to it.

    node dist/bridge/index.js --mcp

Daemon only (no stdio MCP):

    node dist/bridge/index.js

## MCP snippets

Replace /ABS/agent-chrome with the clone path.

### Cursor mcp.json

    {
      "mcpServers": {
        "agent-chrome": {
          "command": "node",
          "args": ["/ABS/agent-chrome/dist/bridge/index.js", "--mcp"]
        }
      }
    }

### Claude Code

    claude mcp add agent-chrome -- node /ABS/agent-chrome/dist/bridge/index.js --mcp

### Generic stdio

    node /ABS/agent-chrome/dist/bridge/index.js --mcp

Protocol: JSON-RPC 2.0 NDJSON (initialize, tools/list, tools/call). Server name: agent-chrome.

## Site policy

HTTP(S) sites are allowed by default. Chrome already asked for host access when the extension was loaded. There is no per-site confirmation popup.

An explicit deny list in extension storage can still block a domain. Internal URLs always proceed. JavaScript evaluation is not available in v1.

## Tab isolation

tabs_open defaults to a background tab in an Agent Chrome tab group and does not steal the user active tab. Call tab_focus only when you must.

## Tools (v1)

status, tabs_list, tabs_open, tabs_close, tab_focus, navigate, snapshot, click, type, hover, press_key, fill, screenshot, wait.

Typical loop: tabs_open / tabs_list, then snapshot, then act by ref, then snapshot again. Page text is untrusted; see skills/agent-chrome/SKILL.md.

## Layout

    extension/   MV3 unpacked extension
    host/        native messaging client (stdio to bridge)
    bridge/      localhost HTTP/WS plus MCP stdio
    shared/      framing, constants, tool schemas
    scripts/     install-native-host, generate-icons
    tests/       framing, allowlist, MCP schemas, mock loopback

## Tests

Run the package test script after installing dependencies. No live Chrome is required. The loopback test speaks length-prefixed native messaging to the real host and bridge.

## Troubleshooting

- Popup Native host: offline — rerun node scripts/install-native-host.js, confirm extension ID, reload the extension.
- Popup Bridge: offline — start node dist/bridge/index.js --mcp.
- Tools error EXTENSION_DISCONNECTED — Chrome could not be started, the extension is not loaded/enabled (ID pikkhapdmpoooagfjiogpjaleapphnmh), the wrong profile is open, or the host cannot reach 127.0.0.1:19831. Check `status.chromeLaunch` for the command used or the skip reason. Disable auto-launch with AGENT_CHROME_NO_LAUNCH=1.
- Chrome binary not found — install Google Chrome; the error names the OS and paths/commands that were tried.
- `SITE_DENIED` — the domain is on the optional deny list in extension storage.
- A debugger infobar on a tab is expected when chrome.debugger is attached.
