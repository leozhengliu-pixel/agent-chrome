#!/usr/bin/env node
/**
 * First-install helper: guide Load unpacked for the Agent Chrome extension.
 *
 * Branded Google Chrome 137+ ignores the legacy unpacked-load CLI flag.
 * This script never passes that flag, never writes Chrome Preferences, and
 * never enables remote debugging. It only: detects (read-only) if the pinned
 * ID is already loaded, copies the absolute extension/ path to the clipboard,
 * opens the extensions management page, reveals the extension folder in the
 * file manager (Finder on macOS — drag that folder onto chrome://extensions
 * after enabling Developer mode), and prints a short checklist. On macOS the
 * primary path is Finder drag; Load unpacked + ⌘⇧G paste is the fallback.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function extensionDir(root = ROOT) {
  return path.join(root, "extension");
}

export function expectedExtensionId(root = ROOT) {
  const idPath = path.join(extensionDir(root), "id.txt");
  return fs.readFileSync(idPath, "utf8").trim();
}

/**
 * Common Chrome / Chromium / Edge user-data roots, then Default + Profile *.
 * Read-only discovery; never creates or writes profiles.
 */
export function findChromeProfileDirs(home = os.homedir(), platform = process.platform, env = process.env) {
  const userDataRoots = [];
  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    userDataRoots.push(
      path.join(base, "Google", "Chrome"),
      path.join(base, "Chromium"),
      path.join(base, "Microsoft Edge"),
      path.join(base, "Google", "Chrome Canary"),
    );
  } else if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    userDataRoots.push(
      path.join(local, "Google", "Chrome", "User Data"),
      path.join(local, "Chromium", "User Data"),
      path.join(local, "Microsoft", "Edge", "User Data"),
    );
  } else {
    const cfg = path.join(home, ".config");
    userDataRoots.push(
      path.join(cfg, "google-chrome"),
      path.join(cfg, "chromium"),
      path.join(cfg, "microsoft-edge"),
      path.join(cfg, "google-chrome-unstable"),
    );
  }

  const profiles = [];
  for (const root of userDataRoots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (name === "Default" || /^Profile \d+$/.test(name)) {
        profiles.push(path.join(root, name));
      }
    }
  }
  return profiles;
}

/**
 * Read-only: true if Preferences or Secure Preferences list the extension id
 * under extensions.settings (or equivalent). Parse failure → false (unknown).
 */
export function isExtensionAlreadyLoaded(profileDir, id) {
  if (!profileDir || !id) return false;
  const files = ["Preferences", "Secure Preferences"];
  for (const name of files) {
    const prefPath = path.join(profileDir, name);
    let raw;
    try {
      raw = fs.readFileSync(prefPath, "utf8");
    } catch {
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const settings =
      data?.extensions?.settings ??
      data?.extensions?.install_signature?.ids ??
      null;
    if (!settings || typeof settings !== "object") continue;
    if (Array.isArray(settings)) {
      if (settings.includes(id)) return true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(settings, id)) {
      const entry = settings[id];
      // Absent path with state 0 can mean removed; treat any present key as loaded
      // unless explicitly disabled/removed (state 0 or location absent and path empty).
      if (entry == null) return true;
      if (typeof entry === "object") {
        if (entry.state === 0) continue; // disabled / removed
        return true;
      }
      return true;
    }
  }
  return false;
}

export function copyToClipboard(text, platform = process.platform) {
  if (text == null) return { ok: false, method: null, error: "empty" };
  try {
    if (platform === "darwin") {
      const r = spawnSync("pbcopy", [], { input: text, encoding: "utf8" });
      if (r.status === 0) return { ok: true, method: "pbcopy" };
      return { ok: false, method: "pbcopy", error: r.error?.message || `exit ${r.status}` };
    }
    if (platform === "win32") {
      const r = spawnSync("clip", [], { input: text, encoding: "utf8", shell: true });
      if (r.status === 0) return { ok: true, method: "clip" };
      return { ok: false, method: "clip", error: r.error?.message || `exit ${r.status}` };
    }
    // Linux: prefer wl-copy, then xclip
    for (const [cmd, args] of [
      ["wl-copy", []],
      ["xclip", ["-selection", "clipboard"]],
    ]) {
      const which = spawnSync("which", [cmd], { encoding: "utf8" });
      if (which.status !== 0) continue;
      const r = spawnSync(cmd, args, { input: text, encoding: "utf8" });
      if (r.status === 0) return { ok: true, method: cmd };
    }
    return { ok: false, method: null, error: "no wl-copy or xclip" };
  } catch (err) {
    return { ok: false, method: null, error: err.message };
  }
}

/** How to paste a path into Chrome's "Load unpacked" folder picker. */
export function folderPickerPasteHint(platform = process.platform) {
  if (platform === "darwin") {
    return "macOS: in the folder picker press ⌘⇧G (Go to Folder), paste (⌘V), Return, then Choose. The list view does not accept paste.";
  }
  if (platform === "win32") {
    return "Windows: in the folder picker click the address bar (or Ctrl+L), paste (Ctrl+V), Enter, then Select Folder.";
  }
  return "Linux: in the folder picker open the location/path bar (often Ctrl+L), paste, Enter, then Select.";
}

/**
 * Reveal/open the extension folder in the OS file manager so the user can
 * drag it (macOS primary) or navigate to it. Prefers opening the folder itself
 * (contents visible) over reveal-in-parent alone.
 * @returns {{ ok: boolean, method: string|null, error?: string }}
 */
export function revealExtensionFolder(absPath, platform = process.platform) {
  if (!absPath) return { ok: false, method: null, error: "empty path" };
  try {
    if (platform === "darwin") {
      // `open <dir>` opens a Finder window on that folder (clearer for drag).
      const r = spawnSync("open", [absPath], { encoding: "utf8" });
      if (r.status === 0) return { ok: true, method: "open" };
      return { ok: false, method: "open", error: r.error?.message || `exit ${r.status}` };
    }
    if (platform === "win32") {
      const r = spawnSync("explorer", [absPath], { encoding: "utf8" });
      // explorer often returns non-zero even on success; treat spawn error only
      if (r.error) return { ok: false, method: "explorer", error: r.error.message };
      return { ok: true, method: "explorer" };
    }
    const which = spawnSync("which", ["xdg-open"], { encoding: "utf8" });
    if (which.status !== 0) {
      return { ok: false, method: null, error: "xdg-open not found" };
    }
    const r = spawnSync("xdg-open", [absPath], { encoding: "utf8" });
    if (r.status === 0) return { ok: true, method: "xdg-open" };
    return { ok: false, method: "xdg-open", error: r.error?.message || `exit ${r.status}` };
  } catch (err) {
    return { ok: false, method: null, error: err.message };
  }
}

function whichSync(cmd) {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim().split("\n")[0] || null;
  return null;
}

/**
 * Open the extensions management page in Google Chrome (or Chromium on Linux).
 * Does not pass the legacy unpacked-load CLI flag or any preference-injection flags.
 */
export function openChromeExtensionsPage(platform = process.platform, env = process.env) {
  const url = "chrome://extensions";
  try {
    if (platform === "darwin") {
      const child = spawn("open", ["-a", "Google Chrome", url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref?.();
      return { ok: true, command: `open -a "Google Chrome" ${url}` };
    }
    if (platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", "chrome", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env,
      });
      child.unref?.();
      return { ok: true, command: `cmd /c start "" chrome ${url}` };
    }
    const candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    let chosen = null;
    for (const name of candidates) {
      chosen = whichSync(name);
      if (chosen) break;
    }
    if (!chosen) {
      for (const p of [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ]) {
        if (fs.existsSync(p)) {
          chosen = p;
          break;
        }
      }
    }
    if (!chosen) {
      return { ok: false, error: "Chrome/Chromium binary not found" };
    }
    const child = spawn(chosen, [url], { detached: true, stdio: "ignore", env });
    child.unref?.();
    return { ok: true, command: `${chosen} ${url}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseArgv(argv) {
  return {
    force: argv.includes("--force"),
    noOpen: argv.includes("--no-open"),
    json: argv.includes("--json"),
  };
}

function anyProfileHasExtension(id, profileDirs) {
  const found = [];
  for (const dir of profileDirs) {
    if (isExtensionAlreadyLoaded(dir, id)) found.push(dir);
  }
  return found;
}

function buildChecklist(platform, absPath, expectedId, pasteHint, revealOk) {
  if (platform === "darwin") {
    return [
      "1. Enable Developer mode (toggle, top-right on chrome://extensions).",
      "2. From the Finder window that opened, drag the `extension` folder onto the chrome://extensions page.",
      `3. Or: Click Load unpacked, then ${pasteHint}`,
      `4. Confirm the extension ID is ${expectedId}.`,
      `   Folder path: ${absPath}`,
    ];
  }
  const revealNote = revealOk
    ? " (a file manager window was opened to this folder)"
    : "";
  return [
    "1. Enable Developer mode (toggle, top-right on chrome://extensions).",
    "2. Click Load unpacked.",
    `3. Select this folder (contains manifest.json; path is on your clipboard if copy succeeded)${revealNote}:\n   ${absPath}`,
    `4. ${pasteHint}`,
    `5. Confirm the extension ID is ${expectedId}.`,
  ];
}

/**
 * Guide the human (or desktop-driving agent) through Load unpacked.
 * @returns {{ ok: boolean, code: number, alreadyLoaded: boolean, extensionPath?: string, expectedId?: string, profiles?: string[], opened?: boolean, clipboard?: object, reveal?: object, message?: string }}
 */
export function installExtensionGuide(options = {}) {
  const root = options.root ?? ROOT;
  const flags = options.flags ?? parseArgv(process.argv.slice(2));
  const force = options.force ?? flags.force;
  const noOpen = options.noOpen ?? flags.noOpen;
  const asJson = options.json ?? flags.json;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const findProfiles = options.findChromeProfileDirs ?? findChromeProfileDirs;
  const copy = options.copyToClipboard ?? copyToClipboard;
  const openPage = options.openChromeExtensionsPage ?? openChromeExtensionsPage;
  const reveal = options.revealExtensionFolder ?? revealExtensionFolder;
  const platform = options.platform ?? process.platform;

  const extDir = extensionDir(root);
  const manifestPath = path.join(extDir, "manifest.json");
  const idPath = path.join(extDir, "id.txt");

  if (!fs.existsSync(manifestPath) || !fs.existsSync(idPath)) {
    const message = `Extension directory missing or incomplete: ${extDir} (need manifest.json and id.txt)`;
    if (asJson) {
      log(JSON.stringify({ ok: false, code: 1, error: message, extensionPath: extDir }));
    } else {
      console.error(message);
    }
    return { ok: false, code: 1, alreadyLoaded: false, extensionPath: extDir, message };
  }

  const expectedId = expectedExtensionId(root);
  const absPath = path.resolve(extDir);
  const profiles = findProfiles();
  const loadedIn = anyProfileHasExtension(expectedId, profiles);
  const alreadyLoaded = loadedIn.length > 0;

  if (alreadyLoaded && !force) {
    const message = `Extension ${expectedId} already loaded in: ${loadedIn.join(", ")}`;
    if (asJson) {
      log(
        JSON.stringify({
          ok: true,
          code: 0,
          alreadyLoaded: true,
          expectedId,
          extensionPath: absPath,
          profiles: loadedIn,
          opened: false,
          message,
        }),
      );
    } else {
      log(`✓ Agent Chrome extension already loaded (id ${expectedId}).`);
      for (const p of loadedIn) log(`  profile: ${p}`);
      log("Skipping chrome://extensions open (pass --force to reopen the guide).");
    }
    return {
      ok: true,
      code: 0,
      alreadyLoaded: true,
      expectedId,
      extensionPath: absPath,
      profiles: loadedIn,
      opened: false,
      message,
    };
  }

  const clipboard = copy(absPath, platform);
  let opened = false;
  let openResult = null;
  if (!noOpen) {
    openResult = openPage(platform);
    opened = !!openResult?.ok;
  }

  const revealResult = reveal(absPath, platform);
  const pasteHint = folderPickerPasteHint(platform);
  const checklist = buildChecklist(platform, absPath, expectedId, pasteHint, !!revealResult?.ok);

  if (asJson) {
    log(
      JSON.stringify({
        ok: true,
        code: 0,
        alreadyLoaded,
        expectedId,
        extensionPath: absPath,
        profiles: loadedIn,
        opened,
        clipboard,
        open: openResult,
        finder: revealResult,
        reveal: revealResult,
        checklist,
        note: "Chrome 137+ ignores the legacy unpacked-load CLI flag; Load unpacked is required once. On macOS prefer dragging the extension folder from Finder onto chrome://extensions after enabling Developer mode.",
      }),
    );
  } else {
    log("");
    log("Agent Chrome — load the unpacked extension (one-time)");
    log("─────────────────────────────────────────────────────");
    log(`Extension folder: ${absPath}`);
    log(`Expected ID:      ${expectedId}`);
    if (clipboard.ok) {
      log(`Clipboard:        path copied via ${clipboard.method}`);
    } else {
      warn(`Clipboard:        could not copy (${clipboard.error || "unavailable"}); paste the path above manually.`);
    }
    if (revealResult.ok) {
      const where =
        platform === "darwin"
          ? "Finder"
          : platform === "win32"
            ? "Explorer"
            : "file manager";
      log(`Reveal:           opened ${where} via ${revealResult.method} → ${absPath}`);
    } else {
      warn(`Reveal:           could not open folder (${revealResult.error || "unavailable"}); navigate to the path above.`);
    }
    if (platform === "darwin") {
      log("Primary (macOS):  Enable Developer mode, then drag the `extension` folder from Finder onto chrome://extensions.");
      log(`Fallback:         Load unpacked → ${pasteHint}`);
    } else {
      log(`Paste tip:        ${pasteHint}`);
    }
    if (noOpen) {
      log("Browser:          --no-open; open chrome://extensions yourself.");
    } else if (opened) {
      log(`Browser:          opened chrome://extensions (${openResult.command})`);
    } else {
      warn(`Browser:          could not open Chrome (${openResult?.error || "unknown"}); open chrome://extensions manually.`);
    }
    log("");
    log("Next clicks (Chrome limitation — not silent-installable on branded Chrome):");
    for (const line of checklist) log(line);
    log("");
    log("Do not use the legacy unpacked-load CLI flag or edit Chrome Preferences; branded Chrome 137+ ignores that flag.");
  }

  return {
    ok: true,
    code: 0,
    alreadyLoaded,
    expectedId,
    extensionPath: absPath,
    profiles: loadedIn,
    opened,
    clipboard,
    reveal: revealResult,
    finder: revealResult,
    message: alreadyLoaded ? "forced guide" : "guide printed",
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = installExtensionGuide();
  process.exit(result.code);
}
