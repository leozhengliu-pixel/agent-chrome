import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS, TOOL_NAMES } from "../shared/tools.js";
import { handleMcp } from "../bridge/mcp.js";

const REQUIRED = [
  "status",
  "tabs_list",
  "tabs_open",
  "tabs_close",
  "tab_focus",
  "navigate",
  "snapshot",
  "click",
  "type",
  "hover",
  "press_key",
  "fill",
  "screenshot",
  "wait",
];

test("v1 tool catalog is complete and has no eval_js", () => {
  assert.deepEqual([...TOOL_NAMES].sort(), [...REQUIRED].sort());
  assert.ok(!TOOL_NAMES.includes("eval_js"));
});

test("each tool has a JSON Schema object with additionalProperties false", () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.name, "string");
    assert.ok(tool.description.length > 8, tool.name);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.inputSchema.properties, "object");
    if (tool.inputSchema.required) {
      for (const key of tool.inputSchema.required) {
        assert.ok(key in tool.inputSchema.properties, `${tool.name} missing required ${key}`);
      }
    }
  }
});

test("tools/list matches TOOLS", async () => {
  const listed = (await handleMcp(async () => ({}), {
    method: "tools/list",
  })) as { tools: Array<{ name: string; inputSchema: unknown }> };
  assert.equal(listed.tools.length, TOOLS.length);
  assert.deepEqual(
    listed.tools.map((t) => t.name),
    TOOL_NAMES,
  );
});

test("initialize handshake", async () => {
  const result = (await handleMcp(async () => ({}), { method: "initialize" })) as {
    serverInfo: { name: string };
    capabilities: { tools: object };
  };
  assert.equal(result.serverInfo.name, "agent-chrome");
  assert.ok(result.capabilities.tools);
});

test("unknown tool call is an error result", async () => {
  const result = (await handleMcp(async () => ({}), {
    method: "tools/call",
    params: { name: "eval_js", arguments: {} },
  })) as { isError?: boolean };
  assert.equal(result.isError, true);
});
