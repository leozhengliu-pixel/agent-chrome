const attached = new Set();

export function isAttached(tabId) {
  return attached.has(tabId);
}

export function attachedTabs() {
  return [...attached];
}

export function markDetached(tabId) {
  attached.delete(tabId);
}

export async function send(tabId, method, params = {}) {
  try {
    return await chrome.debugger.sendCommand({ tabId }, method, params);
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`${method} failed: ${msg}`);
  }
}

export async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    const msg = err?.message || String(err);
    if (!/already attached/i.test(msg)) throw new Error(`debugger attach failed: ${msg}`);
  }
  attached.add(tabId);
  await send(tabId, "Page.enable");
  await send(tabId, "DOM.enable");
  await send(tabId, "Runtime.enable");
  await send(tabId, "Accessibility.enable");
  try {
    await send(tabId, "Overlay.enable");
  } catch {
    // Overlay is optional
  }
}

export async function detach(tabId) {
  if (!attached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // ignore
  }
  attached.delete(tabId);
}

export async function getBoxCenter(tabId, backendDOMNodeId) {
  try {
    await send(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId: backendDOMNodeId });
  } catch {
    // some nodes cannot scroll
  }
  const model = await send(tabId, "DOM.getBoxModel", { backendNodeId: backendDOMNodeId });
  const quad = model?.model?.content || model?.model?.border || model?.model?.padding;
  if (!quad || quad.length < 8) throw new Error("element has no box model");
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { x, y, width, height };
}

export async function highlightNode(tabId, backendDOMNodeId) {
  try {
    await send(tabId, "Overlay.highlightNode", {
      backendNodeId: backendDOMNodeId,
      highlightConfig: {
        showInfo: true,
        contentColor: { r: 16, g: 185, b: 185, a: 0.35 },
        paddingColor: { r: 16, g: 185, b: 185, a: 0.18 },
      },
    });
  } catch {
    // overlay optional
  }
}

const KEY_MAP = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  Return: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
};

function modifierMask(modifiers = []) {
  let mask = 0;
  for (const m of modifiers) {
    const n = String(m).toLowerCase();
    if (n === "alt") mask |= 1;
    else if (n === "control" || n === "ctrl") mask |= 2;
    else if (n === "meta" || n === "command" || n === "cmd") mask |= 4;
    else if (n === "shift") mask |= 8;
  }
  return mask;
}

export async function dispatchMouse(tabId, type, x, y, extra = {}) {
  await send(tabId, "Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: extra.button || "left",
    clickCount: extra.clickCount || 1,
    modifiers: extra.modifiers || 0,
  });
}

export async function insertText(tabId, text) {
  await send(tabId, "Input.insertText", { text });
}

export async function pressKey(tabId, key, modifiers = []) {
  const named = KEY_MAP[key] || (key.length === 1
    ? {
        key,
        code: /^[a-zA-Z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
        windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      }
    : { key, code: key, windowsVirtualKeyCode: 0 });
  const mods = modifierMask(modifiers);
  const payload = { ...named, modifiers: mods };
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...payload });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...payload });
}

export async function focusBackendNode(tabId, backendDOMNodeId) {
  await send(tabId, "DOM.focus", { backendNodeId: backendDOMNodeId });
}

export async function captureScreenshot(tabId, options = {}) {
  const params = { format: "png", fromSurface: true };
  if (options.clip) params.clip = options.clip;
  if (options.captureBeyondViewport) params.captureBeyondViewport = true;
  const result = await send(tabId, "Page.captureScreenshot", params);
  return result?.data;
}
