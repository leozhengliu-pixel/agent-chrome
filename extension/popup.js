function pill(el, on, onText, offText) {
  el.className = `pill ${on ? "on" : "off"}`;
  el.textContent = on ? onText : offText;
}

async function refresh() {
  const data = await chrome.runtime.sendMessage({ type: "popup-status" });
  document.getElementById("version").textContent = `v${data.version || chrome.runtime.getManifest().version}`;
  pill(document.getElementById("native"), data.nativeConnected, "connected", "offline");
  pill(document.getElementById("bridge"), data.bridgeConnected, "connected", "offline");
  const mcp = data.mcpCommand || "node /path/to/agent-chrome/dist/bridge/index.js --mcp";
  document.getElementById("mcp").textContent = mcp;
  document.getElementById("error").textContent = data.lastError || "None";
  document.getElementById("extid").textContent = data.extensionId || "";
}

document.getElementById("copy").addEventListener("click", async () => {
  const text = document.getElementById("mcp").textContent;
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("copy").textContent = "Copied";
    setTimeout(() => { document.getElementById("copy").textContent = "Copy command"; }, 1200);
  } catch {
    document.getElementById("copy").textContent = "Copy failed";
  }
});

document.getElementById("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "reconnect" });
  setTimeout(refresh, 400);
});

refresh();
setInterval(refresh, 1500);
