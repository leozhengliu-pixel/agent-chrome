import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "scripts", "install-extension.js"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root not found");
}

const ROOT = repoRoot();
const SCRIPT = path.join(ROOT, "scripts", "install-extension.js");

async function load() {
  return import(pathToFileURL(SCRIPT).href);
}

test("extensionDir resolves to ROOT/extension with manifest and id.txt", async () => {
  const mod = await load();
  const dir = mod.extensionDir();
  assert.equal(dir, path.join(ROOT, "extension"));
  assert.equal(fs.existsSync(path.join(dir, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(dir, "id.txt")), true);
  assert.equal(mod.expectedExtensionId(), fs.readFileSync(path.join(dir, "id.txt"), "utf8").trim());
});

test("installExtensionGuide fails when extension dir is missing", async () => {
  const mod = await load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-noext-"));
  const logs: string[] = [];
  const result = mod.installExtensionGuide({
    root: tmp,
    noOpen: true,
    json: true,
    log: (s: string) => logs.push(String(s)),
    warn: () => {},
    findChromeProfileDirs: () => [],
    copyToClipboard: () => ({ ok: false, method: null, error: "skip" }),
    openChromeExtensionsPage: () => ({ ok: false, error: "skip" }),
    revealExtensionFolder: () => ({ ok: false, method: null, error: "skip" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
  assert.match(logs.join("\n"), /missing|incomplete/i);
});

test("isExtensionAlreadyLoaded reads Preferences fixture read-only", async () => {
  const mod = await load();
  const id = "pikkhapdmpoooagfjiogpjaleapphnmh";
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-pref-"));
  const prefs = {
    extensions: {
      settings: {
        [id]: { path: "/fake/extension", state: 1 },
      },
    },
  };
  fs.writeFileSync(path.join(profile, "Preferences"), JSON.stringify(prefs));
  assert.equal(mod.isExtensionAlreadyLoaded(profile, id), true);
  assert.equal(mod.isExtensionAlreadyLoaded(profile, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), false);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-pref-bad-"));
  fs.writeFileSync(path.join(empty, "Preferences"), "{not-json");
  assert.equal(mod.isExtensionAlreadyLoaded(empty, id), false);

  const disabledProfile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-pref-dis-"));
  fs.writeFileSync(
    path.join(disabledProfile, "Preferences"),
    JSON.stringify({ extensions: { settings: { [id]: { state: 0 } } } }),
  );
  assert.equal(mod.isExtensionAlreadyLoaded(disabledProfile, id), false);
});

test("installExtensionGuide skips open when already loaded unless force", async () => {
  const mod = await load();
  const id = mod.expectedExtensionId();
  let opened = 0;
  let revealed = 0;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-loaded-"));
  fs.writeFileSync(
    path.join(profile, "Preferences"),
    JSON.stringify({ extensions: { settings: { [id]: { state: 1, path: mod.extensionDir() } } } }),
  );
  const r2 = mod.installExtensionGuide({
    force: false,
    json: true,
    log: () => {},
    warn: () => {},
    findChromeProfileDirs: () => [profile],
    copyToClipboard: () => {
      throw new Error("should not copy when already loaded");
    },
    openChromeExtensionsPage: () => {
      opened += 1;
      return { ok: true, command: "noop" };
    },
    revealExtensionFolder: () => {
      revealed += 1;
      return { ok: true, method: "test" };
    },
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.alreadyLoaded, true);
  assert.equal(r2.opened, false);
  assert.equal(opened, 0);
  assert.equal(revealed, 0);

  const r3 = mod.installExtensionGuide({
    force: true,
    noOpen: true,
    json: true,
    log: () => {},
    warn: () => {},
    findChromeProfileDirs: () => [profile],
    copyToClipboard: () => ({ ok: true, method: "test" }),
    openChromeExtensionsPage: () => {
      opened += 1;
      return { ok: true, command: "noop" };
    },
    revealExtensionFolder: () => {
      revealed += 1;
      return { ok: true, method: "test" };
    },
  });
  assert.equal(r3.ok, true);
  assert.equal(opened, 0);
  assert.equal(revealed, 1);
});

test("install-extension.js source forbids banned Chrome flags and Preference writes", async () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const bannedFlag = "--" + "load-extension";
  const bannedPort = "--" + "remote-debugging-port";
  assert.equal(src.includes(bannedFlag), false);
  assert.equal(src.includes(bannedPort), false);
  assert.doesNotMatch(src, /writeFileSync\([^)]*Preferences/);
  assert.doesNotMatch(src, /writeFile\([^)]*Preferences/);
  assert.doesNotMatch(src, /writeFileSync\([^)]*Secure Preferences/);
  assert.match(src, /read-only|Read-only|never write/i);
});

test("findChromeProfileDirs discovers Default under a fake home", async () => {
  const mod = await load();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-home-"));
  fs.mkdirSync(path.join(home, ".config", "google-chrome", "Default"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config", "google-chrome", "Profile 1"), { recursive: true });
  const dirs = mod.findChromeProfileDirs(home, "linux", {});
  assert.ok(dirs.some((d: string) => d.endsWith(`${path.sep}Default`)));
  assert.ok(dirs.some((d: string) => d.includes("Profile 1")));
});

test("folderPickerPasteHint for darwin mentions Go to Folder / ⌘⇧G", async () => {
  const mod = await load();
  const hint = mod.folderPickerPasteHint("darwin");
  assert.match(hint, /Go to Folder|⌘⇧G|Cmd/i);
  assert.match(mod.folderPickerPasteHint("win32"), /address bar|Ctrl\+L/i);
  assert.match(mod.folderPickerPasteHint("linux"), /location|Ctrl\+L/i);
});

test("revealExtensionFolder is called during guide when not already loaded", async () => {
  const mod = await load();
  const revealed: string[] = [];
  const logs: string[] = [];
  const result = mod.installExtensionGuide({
    force: true,
    noOpen: true,
    json: true,
    platform: "darwin",
    log: (s: string) => logs.push(String(s)),
    warn: () => {},
    findChromeProfileDirs: () => [],
    copyToClipboard: () => ({ ok: true, method: "pbcopy" }),
    openChromeExtensionsPage: () => ({ ok: false, error: "skip" }),
    revealExtensionFolder: (absPath: string) => {
      revealed.push(absPath);
      return { ok: true, method: "open" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0], path.resolve(mod.extensionDir()));
  assert.equal(result.reveal?.ok, true);
  assert.equal(result.finder?.method, "open");
  const payload = JSON.parse(logs[0]);
  assert.equal(payload.finder.ok, true);
  assert.equal(payload.reveal.method, "open");
  assert.ok(payload.checklist.some((line: string) => /drag/i.test(line)));
});

test("darwin checklist leads with Finder drag; pasteHint is fallback", async () => {
  const mod = await load();
  const logs: string[] = [];
  mod.installExtensionGuide({
    force: true,
    noOpen: true,
    json: false,
    platform: "darwin",
    log: (s: string) => logs.push(String(s)),
    warn: () => {},
    findChromeProfileDirs: () => [],
    copyToClipboard: () => ({ ok: true, method: "pbcopy" }),
    openChromeExtensionsPage: () => ({ ok: false, error: "skip" }),
    revealExtensionFolder: () => ({ ok: true, method: "open" }),
  });
  const text = logs.join("\n");
  assert.match(text, /Finder/i);
  assert.match(text, /drag/i);
  assert.match(text, /Developer mode/i);
  assert.match(text, /⌘⇧G|Go to Folder/i);
});
