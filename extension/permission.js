const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
const url = params.get("url") || "";
document.getElementById("domain").textContent = domain;
document.getElementById("url").textContent = url;

async function choose(decision) {
  await chrome.runtime.sendMessage({ type: "permission-decision", domain, decision });
  window.close();
}

document.getElementById("once").addEventListener("click", () => choose("allow-once"));
document.getElementById("site").addEventListener("click", () => choose("allow"));
document.getElementById("deny").addEventListener("click", () => choose("deny"));
