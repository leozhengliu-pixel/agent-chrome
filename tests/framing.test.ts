import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeLengthPrefixed,
  encodeNdjson,
  LengthPrefixedDecoder,
  NdjsonDecoder,
} from "../shared/framing.js";
import { MAX_NATIVE_MESSAGE_BYTES } from "../shared/constants.js";

test("length-prefixed roundtrip", () => {
  const msg = { id: "1", method: "status", params: { ok: true } };
  const buf = encodeLengthPrefixed(msg);
  assert.equal(buf.readUInt32LE(0), buf.length - 4);
  const decoder = new LengthPrefixedDecoder();
  assert.deepEqual(decoder.push(buf), [msg]);
});

test("length-prefixed split header and body across chunks", () => {
  const msg = { hello: "chrome", n: 42 };
  const buf = encodeLengthPrefixed(msg);
  const decoder = new LengthPrefixedDecoder();
  assert.deepEqual(decoder.push(buf.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(buf.subarray(2, 6)), []);
  assert.deepEqual(decoder.push(buf.subarray(6)), [msg]);
});

test("length-prefixed multiple messages in one chunk", () => {
  const a = { a: 1 };
  const b = { b: 2 };
  const decoder = new LengthPrefixedDecoder();
  const out = decoder.push(Buffer.concat([encodeLengthPrefixed(a), encodeLengthPrefixed(b)]));
  assert.deepEqual(out, [a, b]);
});

test("length-prefixed rejects oversized messages", () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_NATIVE_MESSAGE_BYTES + 1, 0);
  const decoder = new LengthPrefixedDecoder();
  assert.throws(() => decoder.push(header), /too large/);
});

test("ndjson roundtrip and blank lines", () => {
  const decoder = new NdjsonDecoder();
  const a = { jsonrpc: "2.0", method: "ping" };
  const chunk = Buffer.concat([encodeNdjson(a), Buffer.from("\n"), encodeNdjson({ id: 2 })]);
  assert.deepEqual(decoder.push(chunk), [a, { id: 2 }]);
});
