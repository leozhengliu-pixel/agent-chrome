(() => {
  if (window.__agentChromeCursorInstalled) return;
  window.__agentChromeCursorInstalled = true;

  let root = null;
  let halo = null;
  let hideTimer = null;
  let last = null;

  function ensure() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "agent-chrome-cursor";
    root.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "z-index:2147483647",
      "pointer-events:none",
      "opacity:0",
      "transition:left 180ms ease-out, top 180ms ease-out, opacity 120ms ease",
    ].join(";");

    halo = document.createElement("div");
    halo.style.cssText = [
      "position:absolute",
      "left:-32px",
      "top:-32px",
      "width:64px",
      "height:64px",
      "border-radius:50%",
      "background:radial-gradient(circle, rgba(59,130,246,0.55) 0%, rgba(59,130,246,0.28) 38%, rgba(59,130,246,0.08) 62%, rgba(59,130,246,0) 72%)",
      "transform:scale(1)",
      "transition:transform 140ms ease-out",
    ].join(";");

    const pointer = document.createElement("div");
    pointer.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 18 24" fill="none">' +
      '<path d="M1.2 1.1 L1.2 19.4 L6.1 14.8 L10.6 23.1 L13.4 21.7 L8.8 13.2 L16.6 12.9 Z" fill="#111827" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>' +
      "</svg>";
    pointer.style.cssText = "position:absolute;left:0;top:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35));";

    root.appendChild(halo);
    root.appendChild(pointer);
    document.documentElement.appendChild(root);
    return root;
  }

  function moveTo(x, y, pulse) {
    const el = ensure();
    if (last) {
      el.style.transition = "left 180ms ease-out, top 180ms ease-out, opacity 120ms ease";
    } else {
      el.style.transition = "opacity 120ms ease";
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.opacity = "1";
    last = { x, y };
    if (pulse && halo) {
      halo.style.transform = "scale(1.25)";
      setTimeout(() => {
        if (halo) halo.style.transform = "scale(1)";
      }, 140);
    }
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 1800);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "agent-chrome-clear-highlight") {
      if (root) root.style.opacity = "0";
      return;
    }
    if (msg.type !== "agent-chrome-highlight") return;
    const rect = msg.rect || {};
    moveTo(Number(rect.x) || 0, Number(rect.y) || 0, Boolean(msg.pulse));
  });
})();
