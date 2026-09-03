import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "extension", "cdp.js"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root not found");
}

test("extension does not enable Runtime or call Runtime.evaluate", () => {
  const root = repoRoot();
  const cdp = fs.readFileSync(path.join(root, "extension", "cdp.js"), "utf8");
  assert.doesNotMatch(cdp, /Runtime\.enable/);
  assert.doesNotMatch(cdp, /Runtime\.evaluate/);
  const ext = fs.readFileSync(path.join(root, "extension", "actions.js"), "utf8");
  assert.doesNotMatch(ext, /eval_js/);
  assert.doesNotMatch(ext, /Runtime\.evaluate/);
});

test("CI workflow is contents:read only", () => {
  const root = repoRoot();
  const yml = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(yml, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(yml, /NODE_AUTH_TOKEN/);
});

test("npmignore excludes source maps and pem files", () => {
  const root = repoRoot();
  const ignore = fs.readFileSync(path.join(root, ".npmignore"), "utf8");
  assert.match(ignore, /\*\*\/\*\.map/);
  assert.match(ignore, /\.pem/);
});

test("cursor overlay uses a closed shadow root", () => {
  const root = repoRoot();
  const js = fs.readFileSync(path.join(root, "extension", "content.js"), "utf8");
  assert.match(js, /attachShadow\(\{\s*mode:\s*"closed"\s*\}\)/);
});

test("privileged onMessage handlers require extension-page senders", () => {
  const root = repoRoot();
  const js = fs.readFileSync(path.join(root, "extension", "background.js"), "utf8");
  assert.match(js, /sender\.id === chrome\.runtime\.id/);
  assert.match(js, /sender\.tab == null/);
});

test("native host installer refuses other-writable paths", () => {
  const root = repoRoot();
  const js = fs.readFileSync(path.join(root, "scripts", "install-native-host.js"), "utf8");
  assert.match(js, /assertOwnedAndNotWorldWritable/);
  assert.match(js, /0o022/);
  assert.match(js, /allowed_origins/);
});
