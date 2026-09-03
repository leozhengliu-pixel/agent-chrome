#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_ID = fs.readFileSync(path.join(ROOT, "extension", "id.txt"), "utf8").trim();
const HOST_NAME = "com.agentchrome.host";
const hostJs = path.join(ROOT, "dist", "host", "index.js");
const wrapperDir = path.join(ROOT, "dist", "native");

export function assertOwnedAndNotWorldWritable(p, uid = process.getuid?.()) {
  if (process.platform === "win32") return;
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (err) {
    throw new Error(`cannot stat ${p}: ${err.message}`);
  }
  if (st.isSymbolicLink()) {
    throw new Error(`${p} is a symlink; refuse to use it`);
  }
  if (uid != null && st.uid !== uid) {
    throw new Error(`${p} is not owned by the current user (uid ${st.uid} != ${uid})`);
  }
  if (st.mode & 0o022) {
    throw new Error(`${p} is writable by group or others (mode ${(st.mode & 0o777).toString(8)})`);
  }
}

function ensureSafe(p) {
  assertOwnedAndNotWorldWritable(p);
}

function writeWrapper() {
  fs.mkdirSync(wrapperDir, { recursive: true });
  if (process.platform !== "win32") {
    fs.chmodSync(wrapperDir, 0o755);
  }
  ensureSafe(wrapperDir);

  let wrapperPath;
  if (process.platform === "win32") {
    wrapperPath = path.join(wrapperDir, "agent-chrome-host.bat");
    fs.writeFileSync(wrapperPath, `@echo off\r\nnode "${hostJs}" %*\r\n`);
  } else {
    wrapperPath = path.join(wrapperDir, "agent-chrome-host");
    fs.writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexec node "${hostJs}" "$@"\n`,
    );
    fs.chmodSync(wrapperPath, 0o755);
  }
  ensureSafe(wrapperPath);
  return wrapperPath;
}

function installTo(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${HOST_NAME}.json`);
  fs.writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${dest}`);
}

export function installNativeHost() {
  if (!fs.existsSync(hostJs)) {
    console.error("dist/host/index.js is missing. Run the TypeScript build first.");
    process.exit(1);
  }
  ensureSafe(hostJs);
  if (fs.existsSync(wrapperDir)) ensureSafe(wrapperDir);

  const wrapperPath = writeWrapper();
  ensureSafe(hostJs);

  const manifest = {
    name: HOST_NAME,
    description: "Agent Chrome native messaging host",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXT_ID}/`],
  };

  const home = os.homedir();
  if (process.platform === "darwin") {
    installTo(path.join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts"), manifest);
    installTo(path.join(home, "Library/Application Support/Chromium/NativeMessagingHosts"), manifest);
    installTo(path.join(home, "Library/Application Support/Microsoft Edge/NativeMessagingHosts"), manifest);
    installTo(path.join(home, "Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"), manifest);
  } else if (process.platform === "win32") {
    const manPath = path.join(wrapperDir, `${HOST_NAME}.json`);
    fs.writeFileSync(manPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const keys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    ];
    for (const key of keys) {
      try {
        execSync(`reg add "${key}" /ve /t REG_SZ /d "${manPath}" /f`, { stdio: "inherit" });
      } catch {
        console.warn(`Skipped registry key ${key}`);
      }
    }
  } else {
    installTo(path.join(home, ".config/google-chrome/NativeMessagingHosts"), manifest);
    installTo(path.join(home, ".config/chromium/NativeMessagingHosts"), manifest);
    installTo(path.join(home, ".config/microsoft-edge/NativeMessagingHosts"), manifest);
    installTo(path.join(home, ".config/google-chrome-unstable/NativeMessagingHosts"), manifest);
  }

  console.log(`Native host ${HOST_NAME}`);
  console.log(`Extension origin chrome-extension://${EXT_ID}/`);
  console.log(`Host executable ${wrapperPath}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  installNativeHost();
}
