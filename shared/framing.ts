import { MAX_NATIVE_MESSAGE_BYTES } from "./constants.js";

export function encodeLengthPrefixed(value: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  if (json.length > MAX_NATIVE_MESSAGE_BYTES) {
    throw new Error(`native message too large: ${json.length} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export function encodeNdjson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

export class LengthPrefixedDecoder {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (len > MAX_NATIVE_MESSAGE_BYTES) {
        throw new Error(`native message too large: ${len} bytes`);
      }
      if (this.buf.length < 4 + len) break;
      const payload = this.buf.subarray(4, 4 + len).toString("utf8");
      this.buf = this.buf.subarray(4 + len);
      out.push(JSON.parse(payload));
    }
    return out;
  }

  reset(): void {
    this.buf = Buffer.alloc(0);
  }
}

export class NdjsonDecoder {
  private buf = "";

  push(chunk: Buffer | string): unknown[] {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const out: unknown[] = [];
    for (;;) {
      const idx = this.buf.indexOf("\n");
      if (idx === -1) break;
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      out.push(JSON.parse(line));
    }
    return out;
  }

  reset(): void {
    this.buf = "";
  }
}
