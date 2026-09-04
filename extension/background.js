import { dispatch, handlePermissionDecision, getLastError, setLastError, status } from "./actions.js";

const NATIVE_HOST = "com.agentchrome.host";
const VERSION = chrome.runtime.getManifest().version;

let nativePort = null;
let reconnectTimer = null;
let bridgeInfo = {
  connected: false,
  mcpCommand: "",
  version: VERSION,
};

function connectNative() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    setLastError(err?.message || String(err));
    nativePort = null;
    scheduleReconnect();
    return;
  }

  nativePort.onMessage.addListener((msg) => {
    void onNativeMessage(msg);
  });
  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    if (err) setLastError(err);
    nativePort = null;
    bridgeInfo.connected = false;
    scheduleReconnect();
  });
  try {
    nativePort.postMessage({ type: "hello", role: "extension", version: VERSION });
  } catch (err) {
    setLastError(err?.message || String(err));
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, 1500);
}

async function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "hello" && msg.role === "bridge") {
    bridgeInfo = {
      connected: true,
      mcpCommand: msg.mcpCommand || "",
      version: msg.version || VERSION,
    };
    setLastError(null);
    return;
  }
  if (msg.type === "bridge-status") {
    bridgeInfo.connected = Boolean(msg.connected);
    if (msg.mcpCommand) bridgeInfo.mcpCommand = msg.mcpCommand;
    return;
  }
  if (typeof msg.id === "string" && typeof msg.method === "string") {
    try {
      const result = await dispatch(msg.method, msg.params || {});
      postNative({ id: msg.id, result });
    } catch (err) {
      postNative({
        id: msg.id,
        error: {
          code: err.code || "EXTENSION_ERROR",
          message: err.message || String(err),
        },
      });
    }
  }
}

function postNative(payload) {
  if (!nativePort) return;
  try {
    nativePort.postMessage(payload);
  } catch (err) {
    setLastError(err?.message || String(err));
    nativePort = null;
    scheduleReconnect();
  }
}

chrome.runtime.onInstalled.addListener(() => connectNative());
chrome.runtime.onStartup.addListener(() => connectNative());
connectNative();

try {
  chrome.alarms.create("agent-chrome-keepalive", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "agent-chrome-keepalive") connectNative();
  });
} catch {
  // alarms permission should be present
}

function isExtensionPageSender(sender) {
  return Boolean(sender) && sender.id === chrome.runtime.id && sender.tab == null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (
    message.type === "permission-decision" ||
    message.type === "reconnect" ||
    message.type === "popup-status"
  ) {
    if (!isExtensionPageSender(sender)) return;
  }
  if (message.type === "permission-decision") {
    handlePermissionDecision(message).then(sendResponse);
    return true;
  }
  if (message.type === "popup-status") {
    status()
      .then((s) => {
        sendResponse({
          ...s,
          nativeConnected: Boolean(nativePort),
          bridgeConnected: bridgeInfo.connected,
          mcpCommand: bridgeInfo.mcpCommand,
          lastError: getLastError(),
        });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (message.type === "reconnect") {
    if (nativePort) {
      try {
        nativePort.disconnect();
      } catch {
        // ignore
      }
      nativePort = null;
    }
    connectNative();
    sendResponse({ ok: true });
    return true;
  }
});
