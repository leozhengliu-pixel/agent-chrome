import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  ChromeLaunchError,
  describeChromeLaunch,
  formatChromeCommand,
  isChromeLaunchDisabled,
  launchChrome,
  planChromeLaunch,
} from "../shared/launch-chrome.js";

type SpawnCall = { command: string; args: string[]; opts: SpawnOptions };

function existsFrom(files: string[]): (p: string) => boolean {
  const set = new Set(files);
  return (p: string) => set.has(p);
}

function fakeSpawn(calls: SpawnCall[]) {
  return (command: string, args: readonly string[], opts: SpawnOptions): ChildProcess => {
    calls.push({ command, args: [...args], opts });
    return { unref() {}, on() { return this; } } as unknown as ChildProcess;
  };
}

const winEnv = {
  LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local",
  PROGRAMFILES: "C:\\Program Files",
  "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  Path: "C:\\Windows\\System32",
};

test("isChromeLaunchDisabled treats 1/true as disabled", () => {
  assert.equal(isChromeLaunchDisabled({}), false);
  assert.equal(isChromeLaunchDisabled({ AGENT_CHROME_NO_LAUNCH: "" }), false);
  assert.equal(isChromeLaunchDisabled({ AGENT_CHROME_NO_LAUNCH: "0" }), false);
  assert.equal(isChromeLaunchDisabled({ AGENT_CHROME_NO_LAUNCH: "1" }), true);
  assert.equal(isChromeLaunchDisabled({ AGENT_CHROME_NO_LAUNCH: "true" }), true);
});

test("darwin uses open -a Google Chrome when the app exists", () => {
  const plan = planChromeLaunch({
    platform: "darwin",
    env: {},
    existsSync: existsFrom(["/Applications/Google Chrome.app"]),
  });
  assert.deepEqual(plan, { action: "spawn", command: "open", args: ["-a", "Google Chrome"] });
});

test("darwin passes --args --profile-directory when AGENT_CHROME_PROFILE is set", () => {
  const plan = planChromeLaunch({
    platform: "darwin",
    env: { AGENT_CHROME_PROFILE: "Profile 2" },
    existsSync: existsFrom(["/Applications/Google Chrome.app"]),
  });
  assert.equal(plan.action, "spawn");
  if (plan.action !== "spawn") return;
  assert.deepEqual(plan.args, ["-a", "Google Chrome", "--args", "--profile-directory=Profile 2"]);
});

test("darwin falls back to the MacOS binary if the .app bundle is missing", () => {
  const bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const plan = planChromeLaunch({
    platform: "darwin",
    env: { AGENT_CHROME_PROFILE: "Default" },
    existsSync: existsFrom([bin]),
  });
  assert.deepEqual(plan, { action: "spawn", command: bin, args: ["--profile-directory=Default"] });
});

test("darwin errors with the OS name and tried paths when Chrome is missing", () => {
  const plan = planChromeLaunch({
    platform: "darwin",
    env: {},
    existsSync: () => false,
  });
  assert.equal(plan.action, "error");
  if (plan.action !== "error") return;
  assert.match(plan.message, /darwin/);
  assert.match(plan.message, /Google Chrome\.app/);
  assert.match(plan.message, /open -a/);
});

test("win32 prefers LOCALAPPDATA chrome.exe", () => {
  const chrome = "C:\\Users\\sam\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
  const plan = planChromeLaunch({
    platform: "win32",
    env: winEnv,
    existsSync: existsFrom([chrome]),
  });
  assert.deepEqual(plan, { action: "spawn", command: chrome, args: [] });
});

test("win32 uses Program Files when LocalAppData copy is missing", () => {
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const plan = planChromeLaunch({
    platform: "win32",
    env: winEnv,
    existsSync: existsFrom([chrome]),
  });
  assert.deepEqual(plan, { action: "spawn", command: chrome, args: [] });
});

test("win32 uses PATH (where chrome) when install dirs miss chrome.exe", () => {
  const chrome = "C:\\Tools\\chrome.exe";
  const plan = planChromeLaunch({
    platform: "win32",
    env: { ...winEnv, Path: "C:\\Tools;C:\\Windows\\System32" },
    existsSync: existsFrom([chrome]),
  });
  assert.deepEqual(plan, { action: "spawn", command: chrome, args: [] });
});

test("win32 errors with OS name and tried locations when Chrome is missing", () => {
  const plan = planChromeLaunch({
    platform: "win32",
    env: winEnv,
    existsSync: () => false,
  });
  assert.equal(plan.action, "error");
  if (plan.action !== "error") return;
  assert.match(plan.message, /win32/);
  assert.match(plan.message, /LOCALAPPDATA|AppData\\Local/i);
  assert.match(plan.message, /Program Files/);
  assert.match(plan.message, /where chrome/);
});

test("linux prefers google-chrome over chromium when both exist", () => {
  const plan = planChromeLaunch({
    platform: "linux",
    env: { DISPLAY: ":0", PATH: "/usr/bin" },
    existsSync: existsFrom(["/usr/bin/google-chrome", "/usr/bin/chromium"]),
  });
  assert.equal(plan.action, "spawn");
  if (plan.action !== "spawn") return;
  assert.equal(plan.command, "/usr/bin/google-chrome");
});

test("linux uses google-chrome-stable from PATH before Chromium", () => {
  const plan = planChromeLaunch({
    platform: "linux",
    env: { WAYLAND_DISPLAY: "wayland-0", PATH: "/opt/bin:/usr/bin" },
    existsSync: existsFrom(["/opt/bin/google-chrome-stable", "/usr/bin/chromium-browser"]),
  });
  assert.deepEqual(plan, {
    action: "spawn",
    command: "/opt/bin/google-chrome-stable",
    args: [],
  });
});

test("linux uses common /usr/bin path when PATH lookup misses", () => {
  const plan = planChromeLaunch({
    platform: "linux",
    env: { DISPLAY: ":1", PATH: "/empty" },
    existsSync: existsFrom(["/usr/bin/google-chrome-stable"]),
  });
  assert.deepEqual(plan, {
    action: "spawn",
    command: "/usr/bin/google-chrome-stable",
    args: [],
  });
});

test("linux without DISPLAY or WAYLAND_DISPLAY errors and does not pick a binary", () => {
  const plan = planChromeLaunch({
    platform: "linux",
    env: { PATH: "/usr/bin" },
    existsSync: existsFrom(["/usr/bin/google-chrome"]),
  });
  assert.equal(plan.action, "error");
  if (plan.action !== "error") return;
  assert.match(plan.message, /linux/);
  assert.match(plan.message, /DISPLAY/);
  assert.match(plan.message, /WAYLAND_DISPLAY/);
});

test("linux errors with OS name and tried binaries when Chrome is missing", () => {
  const plan = planChromeLaunch({
    platform: "linux",
    env: { DISPLAY: ":0", PATH: "" },
    existsSync: () => false,
  });
  assert.equal(plan.action, "error");
  if (plan.action !== "error") return;
  assert.match(plan.message, /linux/);
  assert.match(plan.message, /google-chrome/);
  assert.match(plan.message, /chromium/);
});

test("NO_LAUNCH skips spawn", () => {
  const calls: SpawnCall[] = [];
  const result = launchChrome({
    platform: "linux",
    env: { AGENT_CHROME_NO_LAUNCH: "1", DISPLAY: ":0", PATH: "/usr/bin" },
    existsSync: existsFrom(["/usr/bin/google-chrome"]),
    spawn: fakeSpawn(calls),
  });
  assert.equal(result.attempted, false);
  assert.match(result.skipReason || "", /AGENT_CHROME_NO_LAUNCH/);
  assert.equal(calls.length, 0);
});

test("launchChrome spawns detached with stdio ignore and does not pass headless flags", () => {
  const calls: SpawnCall[] = [];
  const result = launchChrome({
    platform: "linux",
    env: { DISPLAY: ":0", PATH: "/usr/bin", AGENT_CHROME_PROFILE: "Work" },
    existsSync: existsFrom(["/usr/bin/google-chrome"]),
    spawn: fakeSpawn(calls),
  });
  assert.equal(result.attempted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "/usr/bin/google-chrome");
  assert.deepEqual(calls[0]?.args, ["--profile-directory=Work"]);
  assert.equal(calls[0]?.opts.detached, true);
  assert.equal(calls[0]?.opts.stdio, "ignore");
  assert.equal(calls[0]?.opts.windowsHide, true);
  assert.ok(!calls[0]?.args.some((a) => a.includes("headless") || a.includes("remote-debugging")));
  assert.match(result.command || "", /google-chrome/);
});

test("launchChrome throws ChromeLaunchError naming the OS when the binary is missing", () => {
  const calls: SpawnCall[] = [];
  assert.throws(
    () =>
      launchChrome({
        platform: "darwin",
        env: {},
        existsSync: () => false,
        spawn: fakeSpawn(calls),
      }),
    (err: unknown) => {
      assert.ok(err instanceof ChromeLaunchError);
      assert.match((err as Error).message, /darwin/);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test("describeChromeLaunch reports skip or planned command without spawning", () => {
  assert.match(
    describeChromeLaunch({ platform: "linux", env: { AGENT_CHROME_NO_LAUNCH: "1" } }),
    /AGENT_CHROME_NO_LAUNCH/,
  );
  assert.equal(
    describeChromeLaunch({
      platform: "darwin",
      env: {},
      existsSync: existsFrom(["/Applications/Google Chrome.app"]),
    }),
    formatChromeCommand("open", ["-a", "Google Chrome"]),
  );
});
