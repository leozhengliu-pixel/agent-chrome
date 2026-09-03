import { evaluatePolicy, applyDecision } from "./policy.js";
import { buildSnapshot } from "./ax.js";
import * as cdp from "./cdp.js";

const VERSION = "1.0.0";
const GROUP_TITLE = "Agent Chrome";
const STORAGE_KEY = "sitePolicy";

const onceAllowed = new Set();
const tabRefs = new Map();
let lastError = null;
const pendingPrompts = new Map();

export function getLastError() {
  return lastError;
}

export function setLastError(err) {
  lastError = err ? String(err) : null;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  setLastError(message);
  throw error;
}

async function getStoredPolicy() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function setStoredPolicy(stored) {
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}

export async function handlePermissionDecision(message) {
  const { domain, decision } = message;
  const pending = pendingPrompts.get(domain);
  if (!pending) return { ok: false };
  pendingPrompts.delete(domain);
  const stored = await getStoredPolicy();
  const next = applyDecision({ stored, once: onceAllowed }, domain, decision);
  onceAllowed.clear();
  for (const d of next.once) onceAllowed.add(d);
  await setStoredPolicy(next.stored);
  if (pending.windowId) {
    try {
      await chrome.windows.remove(pending.windowId);
    } catch {
      // already closed
    }
  }
  pending.resolve(decision);
  return { ok: true };
}

async function promptForDomain(domain, url) {
  if (pendingPrompts.has(domain)) {
    return pendingPrompts.get(domain).promise;
  }
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const query = new URLSearchParams({ domain, url: url || "" });
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`permission.html?${query.toString()}`),
    type: "popup",
    width: 440,
    height: 320,
    focused: true,
  });
  pendingPrompts.set(domain, { resolve, promise, windowId: win?.id });
  return promise;
}

export async function ensureUrlAllowed(url) {
  const stored = await getStoredPolicy();
  const verdict = evaluatePolicy({ url, stored, once: onceAllowed });
  if (verdict.action === "proceed") return verdict;
  if (verdict.action === "deny") {
    fail("SITE_DENIED", `Site access denied for ${verdict.domain || url}`);
  }
  const decision = await promptForDomain(verdict.domain, url);
  if (decision === "allow" || decision === "allow-once") return { ...verdict, action: "proceed" };
  fail("SITE_DENIED", `Site access denied for ${verdict.domain}`);
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    fail("TAB_NOT_FOUND", `No tab with id ${tabId}`);
  }
}

async function ensureTabAllowed(tabId) {
  const tab = await getTab(tabId);
  if (tab.url) await ensureUrlAllowed(tab.url);
  return tab;
}

async function waitForLoad(tabId, waitUntil = "complete", timeoutMs = 30000) {
  const started = Date.now();
  const tab = await getTab(tabId);
  if (tab.status === "complete" && waitUntil === "complete") return tab;
  if (tab.status === "loading" && waitUntil === "interactive" && tab.url && tab.url !== "about:blank") {
    // keep waiting for something useful
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId} to reach ${waitUntil}`));
    }, timeoutMs);
    function listener(id, info, updated) {
      if (id !== tabId) return;
      if (waitUntil === "interactive" && (info.status === "loading" || info.status === "complete") && updated?.url) {
        // resolve on first navigation commit-ish
        if (info.status === "complete" || info.title) {
          cleanup();
          resolve(updated);
        }
      }
      if (info.status === "complete") {
        cleanup();
        resolve(updated);
      }
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") {
        cleanup();
        resolve(t);
      }
    }).catch((err) => {
      cleanup();
      reject(err);
    });
    void started;
  });
}

async function isolateTab(tabId) {
  try {
    const tab = await getTab(tabId);
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: GROUP_TITLE });
    let groupId = groups[0]?.id;
    if (groupId == null) {
      groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "cyan", collapsed: false });
    } else {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
    }
    return groupId;
  } catch (err) {
    console.warn("tab group isolate failed", err);
    return null;
  }
}

function serializeTab(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || "",
    active: Boolean(tab.active),
    groupId: tab.groupId,
    status: tab.status,
    pinned: Boolean(tab.pinned),
  };
}

function resolveRef(tabId, ref) {
  const map = tabRefs.get(tabId);
  if (!map || !map[ref]) {
    fail("REF_NOT_FOUND", `Unknown ref ${ref} for tab ${tabId}. Take a snapshot first.`);
  }
  return map[ref];
}

const lastPointer = new Map();

async function viewportCenter(tabId) {
  try {
    const metrics = await cdp.send(tabId, "Page.getLayoutMetrics");
    const view = metrics.cssVisualViewport || metrics.visualViewport || metrics.layoutViewport || {};
    const width = Number(view.clientWidth || view.width || 800);
    const height = Number(view.clientHeight || view.height || 600);
    return { x: width / 2, y: Math.min(180, height / 3) };
  } catch {
    return { x: 240, y: 160 };
  }
}

async function sendToTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch {
      // page may be restricted
    }
  }
}

async function highlightInPage(tabId, rect, label, opts = {}) {
  if (rect && Number.isFinite(Number(rect.x)) && Number.isFinite(Number(rect.y))) {
    lastPointer.set(tabId, { x: Number(rect.x), y: Number(rect.y) });
  }
  await sendToTab(tabId, {
    type: "agent-chrome-highlight",
    rect,
    label,
    pulse: Boolean(opts.pulse),
  });
}

async function armPointer(tabId, rect) {
  const pos = rect || lastPointer.get(tabId) || await viewportCenter(tabId);
  lastPointer.set(tabId, { x: Number(pos.x), y: Number(pos.y) });
  await sendToTab(tabId, { type: "agent-chrome-arm-cursor", rect: pos });
}

async function clearPointer(tabId) {
  lastPointer.delete(tabId);
  await sendToTab(tabId, { type: "agent-chrome-clear-highlight" });
}

export async function status() {
  return {
    version: VERSION,
    extensionId: chrome.runtime.id,
    debuggerAttached: cdp.attachedTabs(),
    lastError,
    onceAllowed: [...onceAllowed],
  };
}

export async function tabsList(params = {}) {
  const query = params.currentWindow ? { currentWindow: true } : {};
  const tabs = await chrome.tabs.query(query);
  return { tabs: tabs.map(serializeTab) };
}

export async function tabsOpen(params) {
  const url = String(params.url || "");
  if (!url) fail("INVALID_ARGS", "url is required");
  await ensureUrlAllowed(url);
  const active = Boolean(params.active);
  const isolate = params.isolate !== false;
  const tab = await chrome.tabs.create({ url, active });
  if (isolate && tab.id != null) await isolateTab(tab.id);
  const loaded = await waitForLoad(tab.id, "complete").catch(() => tab);
  return serializeTab(loaded);
}

export async function tabsClose(params) {
  const tabId = Number(params.tabId);
  await getTab(tabId);
  await chrome.tabs.remove(tabId);
  tabRefs.delete(tabId);
  lastPointer.delete(tabId);
  cdp.markDetached(tabId);
  return { closed: tabId };
}

export async function tabFocus(params) {
  const tabId = Number(params.tabId);
  const tab = await getTab(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (cdp.isAttached(tabId)) await armPointer(tabId);
  return serializeTab(await getTab(tabId));
}

export async function navigate(params) {
  const tabId = Number(params.tabId);
  const url = String(params.url || "");
  if (!url) fail("INVALID_ARGS", "url is required");
  await getTab(tabId);
  await ensureUrlAllowed(url);
  await chrome.tabs.update(tabId, { url });
  const tab = await waitForLoad(tabId, params.waitUntil || "complete");
  tabRefs.delete(tabId);
  if (cdp.isAttached(tabId)) await armPointer(tabId);
  return serializeTab(tab);
}

export async function snapshot(params) {
  const tabId = Number(params.tabId);
  const tab = await ensureTabAllowed(tabId);
  await cdp.ensureAttached(tabId);
  await armPointer(tabId);
  const tree = await cdp.send(tabId, "Accessibility.getFullAXTree");
  const interestingOnly = params.interestingOnly !== false;
  const built = buildSnapshot(tree.nodes || [], { interestingOnly });
  tabRefs.set(tabId, built.refs);
  return {
    tabId,
    url: tab.url,
    title: tab.title,
    refCount: built.refCount,
    tree: built.tree,
  };
}

async function targetRef(tabId, ref, opts = {}) {
  await ensureTabAllowed(tabId);
  await cdp.ensureAttached(tabId);
  const node = resolveRef(tabId, ref);
  if (!node.backendDOMNodeId) fail("REF_NOT_FOUND", `Ref ${ref} has no DOM node`);
  const box = await cdp.getBoxCenter(tabId, node.backendDOMNodeId);
  await highlightInPage(tabId, box, `${ref} ${node.role || ""}`.trim(), opts);
  return { node, box };
}

export async function click(params) {
  const tabId = Number(params.tabId);
  const { node, box } = await targetRef(tabId, String(params.ref), { pulse: true });
  const button = params.button || "left";
  const clickCount = Number(params.clickCount || 1);
  for (let i = 1; i <= clickCount; i += 1) {
    await cdp.dispatchMouse(tabId, "mouseMoved", box.x, box.y, { button });
    await cdp.dispatchMouse(tabId, "mousePressed", box.x, box.y, { button, clickCount: i });
    await cdp.dispatchMouse(tabId, "mouseReleased", box.x, box.y, { button, clickCount: i });
  }
  return { tabId, ref: params.ref, role: node.role, x: box.x, y: box.y };
}

export async function hover(params) {
  const tabId = Number(params.tabId);
  const { node, box } = await targetRef(tabId, String(params.ref));
  await cdp.dispatchMouse(tabId, "mouseMoved", box.x, box.y);
  return { tabId, ref: params.ref, role: node.role, x: box.x, y: box.y };
}

export async function typeText(params) {
  const tabId = Number(params.tabId);
  const { node } = await targetRef(tabId, String(params.ref));
  await cdp.focusBackendNode(tabId, node.backendDOMNodeId);
  await cdp.insertText(tabId, String(params.text ?? ""));
  if (params.submit) await cdp.pressKey(tabId, "Enter");
  return { tabId, ref: params.ref, typed: String(params.text ?? "").length };
}

export async function fill(params) {
  const tabId = Number(params.tabId);
  const { node } = await targetRef(tabId, String(params.ref));
  await cdp.focusBackendNode(tabId, node.backendDOMNodeId);
  const meta = /Mac/i.test(navigator.userAgent) ? ["Meta"] : ["Control"];
  await cdp.pressKey(tabId, "a", meta);
  await cdp.pressKey(tabId, "Backspace");
  await cdp.insertText(tabId, String(params.value ?? ""));
  return { tabId, ref: params.ref, filled: true };
}

export async function pressKey(params) {
  const tabId = Number(params.tabId);
  await ensureTabAllowed(tabId);
  await cdp.ensureAttached(tabId);
  if (params.ref) {
    const node = resolveRef(tabId, String(params.ref));
    if (node.backendDOMNodeId) await cdp.focusBackendNode(tabId, node.backendDOMNodeId);
  }
  await cdp.pressKey(tabId, String(params.key), params.modifiers || []);
  return { tabId, key: params.key };
}

export async function screenshot(params) {
  const tabId = Number(params.tabId);
  await ensureTabAllowed(tabId);
  await cdp.ensureAttached(tabId);
  let clip;
  if (params.ref) {
    const { box } = await targetRef(tabId, String(params.ref));
    clip = {
      x: Math.max(0, box.x - box.width / 2),
      y: Math.max(0, box.y - box.height / 2),
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      scale: 1,
    };
  }
  const data = await cdp.captureScreenshot(tabId, {
    clip,
    captureBeyondViewport: Boolean(params.fullPage) && !clip,
  });
  return { mimeType: "image/png", data, tabId };
}

export async function wait(params = {}) {
  const ms = Number(params.ms ?? 1000);
  if (params.tabId != null && params.loadState) {
    await waitForLoad(Number(params.tabId), params.loadState, Math.max(ms, 1000));
  }
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  if (params.tabId != null) {
    const tab = await getTab(Number(params.tabId));
    return { waited: ms, tab: serializeTab(tab) };
  }
  return { waited: ms };
}

const HANDLERS = {
  status,
  tabs_list: tabsList,
  tabs_open: tabsOpen,
  tabs_close: tabsClose,
  tab_focus: tabFocus,
  navigate,
  snapshot,
  click,
  type: typeText,
  hover,
  press_key: pressKey,
  fill,
  screenshot,
  wait,
};

export async function dispatch(method, params = {}) {
  const fn = HANDLERS[method];
  if (!fn) fail("UNKNOWN_METHOD", `Unknown method ${method}`);
  try {
    const result = await fn(params || {});
    return result;
  } catch (err) {
    setLastError(err?.message || String(err));
    throw err;
  }
}

chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId != null) {
    const tabId = source.tabId;
    cdp.markDetached(tabId);
    void clearPointer(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRefs.delete(tabId);
  lastPointer.delete(tabId);
  cdp.markDetached(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;
  if (!cdp.isAttached(tabId)) return;
  void armPointer(tabId);
});
