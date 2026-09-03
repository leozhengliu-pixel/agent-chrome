#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "extension");
const DEFAULT_OUT = path.join(ROOT, "dist", "agent-chrome-extension.zip");

const SKIP = new Set(["key.pem", ".DS_Store"]);

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (~c) >>> 0;
}

function walk(dir, prefix, files) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || name.endsWith(".pem")) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, rel, files);
    else files.push({ name: rel.replaceAll("\\", "/"), data: fs.readFileSync(full) });
  }
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.data);
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.concat([
      Buffer.from("PK\u0003\u0004", "binary"),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      Buffer.from("PK\u0001\u0002", "binary"),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from("PK\u0005\u0006", "binary"),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

export function collectExtensionFiles(srcDir = SRC) {
  if (!fs.existsSync(path.join(srcDir, "manifest.json"))) {
    throw new Error(`manifest.json missing in ${srcDir}`);
  }
  const files = [];
  walk(srcDir, "", files);
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

export function packExtension(outPath = DEFAULT_OUT, srcDir = SRC) {
  const files = collectExtensionFiles(srcDir);
  if (!files.some((f) => f.name === "manifest.json")) {
    throw new Error("zip would not contain manifest.json at the archive root");
  }
  if (files.some((f) => f.name.endsWith(".pem") || f.name === "key.pem")) {
    throw new Error("zip must not include PEM files");
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = buildZip(files);
  fs.writeFileSync(outPath, buf);
  return { outPath, files: files.map((f) => f.name), bytes: buf.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2] || DEFAULT_OUT;
  const result = packExtension(out);
  console.log(`Wrote ${result.outPath} (${result.bytes} bytes, ${result.files.length} files)`);
  for (const name of result.files) console.log(`  ${name}`);
}
