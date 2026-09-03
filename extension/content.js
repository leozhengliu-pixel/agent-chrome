(() => {
  if (window.__agentChromeCursorInstalled) return;
  window.__agentChromeCursorInstalled = true;

  const TAB_ICON_ID = "agent-chrome-tab-icon";

  let host = null;
  let shadow = null;
  let root = null;
  let halo = null;
  let last = null;
  let faviconWatch = null;
  let applyingFavicon = false;

  function ensure() {
    if (host && host.isConnected && root) return root;
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "left:0",
      "top:0",
      "width:0",
      "height:0",
      "z-index:2147483647",
      "pointer-events:none",
      "overflow:visible",
    ].join(";");
    shadow = host.attachShadow({ mode: "closed" });

    root = document.createElement("div");
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
    pointer.style.cssText =
      "position:absolute;left:0;top:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35));";

    root.appendChild(halo);
    root.appendChild(pointer);
    shadow.appendChild(root);
    (document.documentElement || document.body).appendChild(host);
    return root;
  }

  function drawCursorFavicon(baseImg) {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (baseImg) {
      try {
        ctx.drawImage(baseImg, 0, 0, size, size);
      } catch {
        /* ignore */
      }
    }
    ctx.save();
    ctx.translate(5, 3);
    ctx.scale(1.15, 1.15);
    ctx.beginPath();
    ctx.moveTo(1.2, 1.1);
    ctx.lineTo(1.2, 19.4);
    ctx.lineTo(6.1, 14.8);
    ctx.lineTo(10.6, 23.1);
    ctx.lineTo(13.4, 21.7);
    ctx.lineTo(8.8, 13.2);
    ctx.lineTo(16.6, 12.9);
    ctx.closePath();
    ctx.fillStyle = "#111827";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return canvas.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function applyTabIcon() {
    if (applyingFavicon) return;
    applyingFavicon = true;
    try {
      const href = chrome.runtime.getURL("icons/tab-cursor.svg");
      if (faviconWatch) faviconWatch.disconnect();
      for (const el of [...document.querySelectorAll("link[rel*='icon']")]) {
        if (el.id !== TAB_ICON_ID) el.remove();
      }
      let link = document.getElementById(TAB_ICON_ID);
      if (!link) {
        link = document.createElement("link");
        link.id = TAB_ICON_ID;
        link.rel = "icon";
        link.type = "image/svg+xml";
        (document.head || document.documentElement).appendChild(link);
      }
      link.href = href;
      const head = document.head || document.documentElement;
      if (!faviconWatch) {
        faviconWatch = new MutationObserver(() => {
          if (!document.getElementById(TAB_ICON_ID)) void applyTabIcon();
        });
      }
      faviconWatch.observe(head, { childList: true, subtree: true });
    } finally {
      applyingFavicon = false;
    }
  }

  function restoreTabIcon() {
    if (faviconWatch) {
      faviconWatch.disconnect();
      faviconWatch = null;
    }
    const existing = document.getElementById(TAB_ICON_ID);
    if (existing) existing.remove();
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
    void applyTabIcon();
  }

  function arm(rect, pulse) {
    const x = Number(rect && rect.x);
    const y = Number(rect && rect.y);
    const px = Number.isFinite(x) ? x : last ? last.x : window.innerWidth / 2;
    const py = Number.isFinite(y) ? y : last ? last.y : Math.min(180, window.innerHeight / 3);
    moveTo(px, py, pulse);
  }

  function hide() {
    if (root) root.style.opacity = "0";
    restoreTabIcon();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "agent-chrome-clear-highlight") {
      hide();
      return;
    }
    if (msg.type === "agent-chrome-arm-cursor") {
      arm(msg.rect || {}, false);
      return;
    }
    if (msg.type !== "agent-chrome-highlight") return;
    arm(msg.rect || {}, Boolean(msg.pulse));
  });
})();
