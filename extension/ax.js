const INTERESTING_ROLES = new Set([
  "button",
  "link",
  "textField",
  "searchBox",
  "comboBox",
  "checkBox",
  "radioButton",
  "slider",
  "tab",
  "tabList",
  "menuItem",
  "menu",
  "treeItem",
  "switch",
  "textbox",
  "heading",
  "image",
  "listBox",
  "option",
  "cell",
  "gridCell",
  "dialog",
  "alert",
  "text",
  "list",
  "listItem",
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "form",
  "article",
  "region",
  "iframe",
]);

function axValue(node, key) {
  const v = node?.[key];
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v.value === "string" || typeof v.value === "number" || typeof v.value === "boolean") {
    return String(v.value);
  }
  return "";
}

export function isInteresting(node) {
  if (!node || node.ignored) return false;
  const role = axValue(node, "role");
  if (INTERESTING_ROLES.has(role)) return true;
  const name = axValue(node, "name").trim();
  return Boolean(name);
}

export function buildSnapshot(nodes, { interestingOnly = true } = {}) {
  const byId = new Map();
  for (const n of nodes || []) {
    byId.set(n.nodeId, n);
  }
  const refs = {};
  let counter = 0;
  const lines = [];

  function takeRef(node) {
    counter += 1;
    const ref = `e${counter}`;
    refs[ref] = {
      ref,
      backendDOMNodeId: node.backendDOMNodeId,
      nodeId: node.nodeId,
      role: axValue(node, "role"),
      name: axValue(node, "name"),
    };
    return ref;
  }

  function describe(node) {
    const role = axValue(node, "role") || "generic";
    const name = axValue(node, "name");
    const value = axValue(node, "value");
    const extra = [];
    if (name) extra.push(JSON.stringify(name));
    if (value && value !== name) extra.push(`value=${JSON.stringify(value)}`);
    const states = [];
    if (node.checked?.value === "true" || node.checked?.value === true) states.push("checked");
    if (node.disabled?.value === true || node.disabled === true) states.push("disabled");
    if (node.expanded?.value === true) states.push("expanded");
    if (node.selected?.value === true) states.push("selected");
    if (node.focused?.value === true || node.focused === true) states.push("focused");
    if (states.length) extra.push(states.join(","));
    return extra.length ? `${role} ${extra.join(" ")}` : role;
  }

  function walk(node, depth) {
    if (!node) return;
    const include = !interestingOnly || isInteresting(node) || depth === 0;
    let ref = null;
    if (include && node.backendDOMNodeId) {
      ref = takeRef(node);
      const indent = "  ".repeat(depth);
      lines.push(`${indent}- ${describe(node)} [${ref}]`);
    }
    const nextDepth = include && node.backendDOMNodeId ? depth + 1 : depth;
    for (const childId of node.childIds || []) {
      walk(byId.get(childId), nextDepth);
    }
  }

  const root = (nodes || []).find((n) => n.frameId && !n.parentId) || (nodes || [])[0];
  if (root) walk(root, 0);
  else {
    for (const n of nodes || []) walk(n, 0);
  }

  return { tree: lines.join("\n") || "(empty document)", refs, refCount: counter };
}
