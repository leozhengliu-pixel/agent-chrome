# Contributing to Agent Chrome

Thanks for helping. Agent Chrome is original open-source software (Chrome MV3 extension + native host + local MCP). Please keep it that way.

Issues and pull request discussion may be in **English or Chinese**.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Requires Node.js 20+.

```bash
git clone https://github.com/leozhengliu-pixel/agent-chrome.git
cd agent-chrome
npm install
npm test
npm run build
npm run install-host
```

`npm test` runs `tsc` then `node --test dist/tests/*.js`. No live Chrome is required for tests. `dist/` is gitignored.

Load the unpacked `extension/` directory in Chrome (developer mode). The ID must be `pikkhapdmpoooagfjiogpjaleapphnmh`. Then start the bridge:

```bash
npm run mcp
```

## Unpacked development loop

1. Edit TypeScript under `bridge/`, `host/`, `shared/`, or `tests/`, or JS under `extension/`.
2. Run `npm test` (or `npm run build` if you are only compiling).
3. If you changed the host or shared protocol used by the native host, rerun `npm run install-host`.
4. Reload the unpacked extension on `chrome://extensions` if you changed `extension/`.
5. Restart `npm run mcp` if you changed the bridge or MCP server.
6. If you add, remove, or rename MCP tools, update `README.md` and `skills/agent-chrome/SKILL.md` in the same change.

## Pull requests

- Keep PRs focused. Describe what changed and why.
- Run `npm test` locally before opening a PR. CI runs the same command on Node 20.
- Do not bump the version unless a maintainer asks.
- Do not commit `dist/`, `node_modules/`, `.env`, token files, or other secrets.
- Match existing style. Prefer small, reviewable diffs.

## Project rules

- **No `eval_js` in v1.** Do not add a JavaScript-evaluation tool or expose `Runtime.evaluate` to MCP.
- **Do not copy proprietary extension source** (ChatGPT, Codex, or other vendor extensions). This repo is original software.
- **Do not commit secrets.** Treat `~/.config/agent-chrome/token` (and the macOS / Windows equivalents) as secrets. Never paste tokens into issues or PRs.
- **`extension/key.pem` is public on purpose.** It pins the unpacked extension ID. Do not rotate it in a drive-by PR; rotating it changes `pikkhapdmpoooagfjiogpjaleapphnmh` and breaks native-host `allowed_origins`.

## Bugs and features

Use GitHub issues:

- Bugs: what happened, how to reproduce, OS, Chrome version, Node version, and relevant logs (redact tokens).
- Features: the problem you are solving and a concrete proposal.

Security bugs are not public issues — see [SECURITY.md](SECURITY.md).
