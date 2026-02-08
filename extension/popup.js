/* global chrome */

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

function guessSiteOriginFromUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.hostname === "leetcode.cn" || u.hostname.endsWith(".leetcode.cn")) return "https://leetcode.cn";
    if (u.hostname === "leetcode.com" || u.hostname.endsWith(".leetcode.com")) return "https://leetcode.com";
  } catch (e) {
    // ignore
  }
  return "https://leetcode.com";
}

document.getElementById("btnOpenPlan").addEventListener("click", async () => {
  const tab = await getActiveTab();
  const origin = guessSiteOriginFromUrl(tab && tab.url ? tab.url : "");
  await chrome.tabs.create({ url: `${origin}/studyplan/top-interview-150/` });
  window.close();
});

document.getElementById("btnOpenPanel").addEventListener("click", async () => {
  const tab = await getActiveTab();
  const tabId = tab ? tab.id : undefined;
  try {
    // Chrome 114+.
    await chrome.sidePanel.open({ tabId });
  } catch (e) {
    // Fallback: action click behavior is set in background.js when supported.
  }
  window.close();
});
