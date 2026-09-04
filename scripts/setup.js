#!/usr/bin/env node
/**
 * agent-chrome-setup: install native host, then run the extension Load-unpacked guide.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installNativeHost } from "./install-native-host.js";

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Never skip extension on the combined setup path unless explicitly asked.
  Promise.resolve(installNativeHost())
    .then((r) => {
      if (r && typeof r.code === "number" && r.code !== 0) process.exit(r.code);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
