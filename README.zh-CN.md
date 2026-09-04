# Agent Chrome

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/leozhengliu-pixel/agent-chrome/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-chrome)](https://www.npmjs.com/package/agent-chrome)

[English](README.md) | **中文**

通用的 Chrome MV3 扩展加上本地 bridge，让任意编程代理（Cursor、Claude Code 或 stdio MCP 客户端）都能操控用户已登录的 Chrome。

代理通过真实的桌面浏览器工作——Cookie、SSO、已有标签页以及用户配置文件。无需无头 Chrome，无需远程调试端口，也无需临时配置文件。

## Features

- **MCP tools (v1):** `status`、`tabs_list`、`tabs_open`、`tabs_close`、`tab_focus`、`navigate`、`snapshot`、`click`、`type`、`hover`、`press_key`、`fill`、`screenshot`、`wait`。v1 不含 `eval_js`。
- **Auto-launch Chrome:** 若 Chrome 已关闭，交互式工具会打开带已登录配置文件的 Google Chrome（macOS、Linux、Windows）。
- **Default-allow HTTPS:** HTTP(S) 站点默认允许，无需按站点弹出确认。
- **Persistent agent cursor + tab cursor icon:** 在代理标签页上显示可见指针叠加层，并在标签页 favicon 上显示光标徽章。
- **Native host on Mac/Linux/Windows:** `com.agentchrome.host`，适用于 Chrome、Chromium 和 Edge。

固定的未打包扩展 ID：`pikkhapdmpoooagfjiogpjaleapphnmh`  
Native host：`com.agentchrome.host`  
MCP 名称：`agent-chrome`

## Requirements

- Node.js 20 或更高版本
- Google Chrome（或 Chromium）
- macOS、Linux 或 Windows

## Quick start

安装公开的 npm 包，加载一次未打包扩展，然后将 MCP 指向 `agent-chrome --mcp`。没有 Chrome 网上应用店上架。Chrome 137+ 会忽略 `--load-extension`；请勿使用 `--remote-debugging-port`。

### 1. Install the local bridge and native host

```bash
npm install -g agent-chrome
agent-chrome-install-host
```

命令行工具：`agent-chrome`（bridge）、`agent-chrome-host`、`agent-chrome-install-host`、`agent-chrome-install-extension`、`agent-chrome-setup`。

`agent-chrome-install-host` 也会运行扩展安装引导：把绝对路径 `extension/` 复制到剪贴板、打开扩展页面，并在 Finder（或其他文件管理器）中打开 `extension` 文件夹（除非已检测到固定 ID，或你设置了 `AGENT_CHROME_SKIP_EXTENSION_INSTALL=1` / `--skip-extension`）。可用 `agent-chrome-install-extension` 重新运行。合并命令：`agent-chrome-setup`。

### 2. Load the unpacked extension (human residual step)

在品牌版 Google Chrome 上无法静默完成完整自动安装。主机安装程序（或 `agent-chrome-install-extension`）打开 `chrome://extensions`、复制路径，并在文件管理器中显示 `extension` 文件夹后：

**macOS（推荐）：** 启用开发者模式，然后从打开的 **Finder** 窗口把 `extension` 文件夹**拖到** chrome://extensions 页面上。备选：点击 **Load unpacked** → 按 ⌘⇧G（前往文件夹）→ 粘贴 → 选取。Chrome 文件夹列表不接受 Cmd+V。

**Windows / Linux：** 启用开发者模式 → **Load unpacked** → 在地址栏/位置栏粘贴路径（剪贴板已有；也可能已打开文件管理器窗口）。

文件夹位置：
   - 全局安装：`$(npm root -g)/agent-chrome/extension`
   - 或解压 GitHub Release 资源 [`agent-chrome-extension.zip`](https://github.com/leozhengliu-pixel/agent-chrome/releases/latest)
然后确认 ID 为 `pikkhapdmpoooagfjiogpjaleapphnmh`（公钥在 `manifest.json` 中；私钥在 `extension/key.pem`，有意提交以固定该 ID）。固定工具栏图标。弹窗会显示 native-host / bridge 状态、版本、最后错误以及 MCP 命令。

请保持未打包扩展处于启用状态。若 Chrome 已关闭，交互式工具会在 macOS、Linux 和 Windows 上自动打开带已登录配置文件（`Default`，或 `AGENT_CHROME_PROFILE`）的 Google Chrome，然后等待 native host 重新连接（约 25 秒）。Chrome 会恢复先前加载的未打包扩展，因此 Load unpacked 只需一次。`status` 从不启动 Chrome。

设置 `AGENT_CHROME_NO_LAUNCH=1` 可禁用自动打开。启动器从不使用 `--headless`、`--remote-debugging-port` 或临时 user-data-dir。

### 3. Start MCP

```bash
npx -y agent-chrome --mcp
```

全局安装后也可以运行 `agent-chrome --mcp`。进程绑定 `127.0.0.1:19831`。若另一个**已验证**的 Agent Chrome bridge 已占用该端口（配置目录中的 pid-proof 文件），MCP 会附着到它。占用端口的无关进程不会获得鉴权 token。仅在设置 `AGENT_CHROME_ALLOW_NON_LOOPBACK=1` 时才绑定非回环地址（危险操作；见 SECURITY.md）。

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

协议：JSON-RPC 2.0 NDJSON（`initialize`、`tools/list`、`tools/call`）。服务器名称：`agent-chrome`。

编程代理：从 [`skills/agent-chrome/SKILL.md`](skills/agent-chrome/SKILL.md) 开始。

### From source (optional)

```bash
git clone https://github.com/leozhengliu-pixel/agent-chrome.git
cd agent-chrome
npm install
npm test
npm run build
npm run install-host
```

然后从 `extension/` 加载未打包扩展，并用 `npm run mcp`（`node dist/bridge/index.js --mcp`）启动 MCP。`dist/` 已被 gitignore，因此安装 host 前请先 build（或 test）。`npm run pack` 会写出 `dist/agent-chrome-extension.zip`（zip 根目录含 `manifest.json`，不含 `key.pem`）。

## Architecture

三个进程：

1. **extension/** — Manifest V3 service worker。Native messaging、在代理标签页上使用 `chrome.debugger`、标签页列表、可选的标签组隔离、首次访问站点策略、持久的代理光标与标签页光标图标。
2. **host/** — Native messaging host（Node）。由 Chrome 通过 stdio 启动。它是 bridge 的客户端，不监听端口。
3. **bridge/** — 在 `127.0.0.1:19831` 上的 HTTP + WebSocket（Bearer token 位于用户配置目录；在 macOS/Linux 上优先使用 Unix socket `bridge.sock`），以及名为 `agent-chrome` 的 MCP stdio 服务器。

安装程序（`npm run install-host` / `node scripts/install-native-host.js`）会在 macOS、Linux 和 Windows（HKCU）上为 Chrome、Chromium 和 Edge 写入 `com.agentchrome.host.json`。`allowed_origins` 为 `chrome-extension://pikkhapdmpoooagfjiogpjaleapphnmh/`。安装 host 前请先编译 TypeScript，确保存在 `dist/`。

Token 文件（首次启动 bridge 时创建；请当作密钥保管）：

- Linux：`~/.config/agent-chrome/token`
- macOS：`~/Library/Application Support/agent-chrome/token`
- Windows：`%APPDATA%/agent-chrome/token`

## Site policy

公共 HTTP(S) 站点默认允许。加载扩展时 Chrome 已请求过主机访问权限。对这些站点没有按站点确认弹窗。

回环、RFC1918、链路本地以及云元数据地址会被拒绝。`file:`、`javascript:`、`data:` 和 `ftp:` 会被拒绝。`chrome://` / `devtools:` URL 不会自动允许（`about:blank` 与本扩展自身源除外）。`chrome://extensions` 不会默认放行。

扩展存储中的显式拒绝列表仍可阻止某域名（主机名与 eTLD+1，包括 `foo.github.io`）。JavaScript 求值（`eval_js`）在 v1 中不可用。

## Tab isolation

`tabs_open` 默认在 Agent Chrome 标签组中打开后台标签页，不会抢走用户的当前活动标签页。该组**仅**作为新标签页的默认分组。后续工具（`tabs_list`、`tab_focus`、`snapshot`、`click` 等）不受其约束，可以面向已登录配置文件中的任意标签页（仍受站点策略约束）。仅在必要时调用 `tab_focus`。

## Tools (v1)

`status`、`tabs_list`、`tabs_open`、`tabs_close`、`tab_focus`、`navigate`、`snapshot`、`click`、`type`、`hover`、`press_key`、`fill`、`screenshot`、`wait`。

典型的 snapshot 循环：

1. 用 `tabs_open` 或 `tabs_list` 获取 `tabId`
2. 对该标签页执行 `snapshot`
3. 按 ref 操作（`click` / `type` / `fill` / ...）
4. 在导航或 DOM 变化后再次 `snapshot` —— ref 跨 snapshot 不稳定

页面文本、标题、snapshot 名称和截图均为不可信数据。参见 [`skills/agent-chrome/SKILL.md`](skills/agent-chrome/SKILL.md)。

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

不需要真实的 Chrome。回环测试会对真实的 host 与 bridge 使用带长度前缀的 native messaging 通信。

## Troubleshooting

- Popup Native host: offline — 重新运行 `agent-chrome-install-host`（`npm run install-host`），确认扩展 ID，重新加载扩展。若扩展缺失，运行 `agent-chrome-install-extension` 并完成 Load unpacked。
- Popup Bridge: offline — 启动 `node dist/bridge/index.js --mcp`（`npm run mcp`）。
- 工具错误 `EXTENSION_DISCONNECTED` — Chrome 未能启动、扩展未加载/未启用（ID `pikkhapdmpoooagfjiogpjaleapphnmh`）、打开了错误的配置文件，或 host 无法到达 `127.0.0.1:19831`。查看 `status.chromeLaunch` 了解所用命令或跳过原因。可用 `AGENT_CHROME_NO_LAUNCH=1` 禁用自动启动。
- Chrome binary not found — 安装 Google Chrome；错误信息会给出操作系统以及尝试过的路径/命令。
- `SITE_DENIED` — 该域名位于扩展存储中的可选拒绝列表。
- 当 `chrome.debugger` 已附着时，标签页上出现调试器信息栏是预期行为。

## Community

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [MIT License](LICENSE)
