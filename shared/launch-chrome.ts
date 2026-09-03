import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type SpawnChromeFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;
import fs from "node:fs";
import path from "node:path";

export const CHROME_CONNECT_TIMEOUT_MS = 25_000;

export class ChromeLaunchError extends Error {
  readonly code = "CHROME_LAUNCH_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "ChromeLaunchError";
  }
}

export type LaunchChromeResult = {
  attempted: boolean;
  command?: string;
  skipReason?: string;
};

export type ChromeLaunchPlan =
  | { action: "spawn"; command: string; args: string[] }
  | { action: "skip"; reason: string }
  | { action: "error"; message: string };

export type LaunchChromeDeps = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  spawn?: SpawnChromeFn;
};

const LINUX_CHROME_NAMES = ["google-chrome", "google-chrome-stable"];
const LINUX_CHROMIUM_NAMES = ["chromium-browser", "chromium"];
const LINUX_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/google-chrome",
  "/opt/google/chrome/chrome",
];
const LINUX_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];
const DARWIN_APP = "/Applications/Google Chrome.app";
const DARWIN_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function isChromeLaunchDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.AGENT_CHROME_NO_LAUNCH;
  if (v == null || v.trim() === "") return false;
  const n = v.trim().toLowerCase();
  return n !== "0" && n !== "false" && n !== "no";
}

export function formatChromeCommand(command: string, args: string[] = []): string {
  return [command, ...args].map(quoteArg).join(" ");
}

function quoteArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function profileDirectory(env: NodeJS.ProcessEnv): string | undefined {
  const v = env.AGENT_CHROME_PROFILE?.trim();
  return v || undefined;
}

function profileArgs(env: NodeJS.ProcessEnv): string[] {
  const profile = profileDirectory(env);
  return profile ? [`--profile-directory=${profile}`] : [];
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const raw = platform === "win32" ? env.Path || env.PATH || "" : env.PATH || "";
  const delim = platform === "win32" ? ";" : ":";
  return raw.split(delim).filter(Boolean);
}

function which(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  existsSync: (filePath: string) => boolean,
): string | null {
  const join = pathApi(platform).join;
  const exts =
    platform === "win32"
      ? command.toLowerCase().endsWith(".exe")
        ? [""]
        : [".exe", ".cmd", ".bat", ""]
      : [""];
  for (const dir of pathEntries(env, platform)) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function windowsChromePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const join = pathApi(platform).join;
  const local = env.LOCALAPPDATA || "";
  const pf = env.PROGRAMFILES || env.ProgramFiles || "C:\\Program Files";
  const pf86 = env["PROGRAMFILES(X86)"] || env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const rel = ["Google", "Chrome", "Application", "chrome.exe"] as const;
  const out: string[] = [];
  if (local) out.push(join(local, ...rel));
  out.push(join(pf, ...rel));
  out.push(join(pf86, ...rel));
  return out;
}

function firstExisting(paths: string[], existsSync: (filePath: string) => boolean): string | undefined {
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function planChromeLaunch(deps: LaunchChromeDeps = {}): ChromeLaunchPlan {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const existsSync = deps.existsSync ?? fs.existsSync;

  if (isChromeLaunchDisabled(env)) {
    return { action: "skip", reason: "AGENT_CHROME_NO_LAUNCH is set" };
  }

  if (platform !== "win32" && platform !== "darwin") {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
      return {
        action: "error",
        message: `Cannot launch Chrome on ${platform}: no DISPLAY or WAYLAND_DISPLAY is set. Agent Chrome needs a graphical session (not headless).`,
      };
    }
  }

  const extra = profileArgs(env);

  if (platform === "darwin") {
    const tried = [`open -a "Google Chrome"`, DARWIN_APP, DARWIN_BIN];
    if (existsSync(DARWIN_APP)) {
      const args = ["-a", "Google Chrome"];
      if (extra.length) args.push("--args", ...extra);
      return { action: "spawn", command: "open", args };
    }
    if (existsSync(DARWIN_BIN)) {
      return { action: "spawn", command: DARWIN_BIN, args: extra };
    }
    return {
      action: "error",
      message: `Could not find Google Chrome on darwin. Tried: ${tried.join(", ")}. Install Google Chrome or set AGENT_CHROME_NO_LAUNCH=1.`,
    };
  }

  if (platform === "win32") {
    const standard = windowsChromePaths(env, platform);
    const fromDisk = firstExisting(standard, existsSync);
    const fromPath = which("chrome", env, platform, existsSync);
    const chosen = fromDisk || fromPath;
    if (chosen) {
      return { action: "spawn", command: chosen, args: extra };
    }
    const tried = [...standard, "PATH (where chrome)", 'start chrome'];
    // Do not spawn `start chrome` when the binary is missing — that would hang until connect timeout.
    return {
      action: "error",
      message: `Could not find Google Chrome on win32. Tried: ${tried.join(", ")}. Install Google Chrome or set AGENT_CHROME_NO_LAUNCH=1.`,
    };
  }

  const linuxTried: string[] = [];
  for (const name of LINUX_CHROME_NAMES) {
    linuxTried.push(name);
    const found = which(name, env, platform, existsSync);
    if (found) return { action: "spawn", command: found, args: extra };
  }
  for (const p of LINUX_CHROME_PATHS) {
    linuxTried.push(p);
    if (existsSync(p)) return { action: "spawn", command: p, args: extra };
  }
  for (const name of LINUX_CHROMIUM_NAMES) {
    linuxTried.push(name);
    const found = which(name, env, platform, existsSync);
    if (found) return { action: "spawn", command: found, args: extra };
  }
  for (const p of LINUX_CHROMIUM_PATHS) {
    linuxTried.push(p);
    if (existsSync(p)) return { action: "spawn", command: p, args: extra };
  }

  return {
    action: "error",
    message: `Could not find Google Chrome on ${platform}. Tried: ${linuxTried.join(", ")}. Install Google Chrome (preferred) or Chromium, or set AGENT_CHROME_NO_LAUNCH=1.`,
  };
}

export function launchChrome(deps: LaunchChromeDeps = {}): LaunchChromeResult {
  const plan = planChromeLaunch(deps);
  if (plan.action === "skip") {
    return { attempted: false, skipReason: plan.reason };
  }
  if (plan.action === "error") {
    throw new ChromeLaunchError(plan.message);
  }

  const platform = deps.platform ?? process.platform;
  const spawnFn = deps.spawn ?? spawn;
  const command = formatChromeCommand(plan.command, plan.args);
  const opts: SpawnOptions = {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  };
  try {
    const child: ChildProcess = spawnFn(plan.command, plan.args, opts);
    child.on?.("error", () => {
      /* ignore: wait-for-connect surfaces a timeout if Chrome never attaches */
    });
    child.unref?.();
  } catch (err) {
    throw new ChromeLaunchError(
      `Failed to spawn Chrome on ${platform}: ${(err as Error).message}. Command: ${command}`,
    );
  }
  return { attempted: true, command };
}

export function describeChromeLaunch(deps: LaunchChromeDeps = {}): string {
  const plan = planChromeLaunch(deps);
  if (plan.action === "spawn") return formatChromeCommand(plan.command, plan.args);
  if (plan.action === "skip") return plan.reason;
  return plan.message;
}
