import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "scripts", "pack-extension.js"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root not found");
}
const ROOT = repoRoot();

test("pack-extension writes a root-level manifest and omits PEM files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-pack-"));
  const out = path.join(dir, "agent-chrome-extension.zip");
  const script = path.join(ROOT, "scripts", "pack-extension.js");
  execFileSync(process.execPath, [script, out], { stdio: "pipe" });
  assert.equal(fs.existsSync(out), true);
  const buf = fs.readFileSync(out);
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const asString = buf.toString("binary");
  assert.match(asString, /manifest.json/);
  assert.doesNotMatch(asString, /key.pem/);
});
