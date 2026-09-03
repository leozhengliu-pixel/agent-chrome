(() => {
  if (window.__agentChromeHighlightInstalled) return;
  window.__agentChromeHighlightInstalled = true;
  let overlay = null;
  let hideTimer = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "agent-chrome-highlight";
    overlay.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "pointer-events:none",
      "border:2px solid #14b8a6",
      "background:rgba(20,184,166,0.18)",
      "border-radius:4px",
      "box-shadow:0 0 0 1px rgba(15,23,42,0.25)",
      "transition:opacity 120ms ease",
    ].join(";");
    const label = document.createElement("div");
    label.style.cssText = "position:absolute;left:0;top:-18px;background:#042f2e;color:#ecfeff;font:11px/16px ui-sans-serif,system-ui,sans-serif;padding:0 6px;border-radius:3px;white-space:nowrap;";
    overlay.appendChild(label);
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "agent-chrome-clear-highlight") {
      if (overlay) overlay.style.opacity = "0";
      return;
    }
    if (msg.type !== "agent-chrome-highlight") return;
    const el = ensureOverlay();
    const rect = msg.rect || {};
    const w = Math.max(8, rect.width || 24);
    const h = Math.max(8, rect.height || 24);
    const left = (rect.x || 0) - w / 2;
    const top = (rect.y || 0) - h / 2;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.opacity = "1";
    el.firstChild.textContent = msg.label || "agent";
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 1600);
  });
})();
