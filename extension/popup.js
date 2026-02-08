/* global chrome */

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

function normalizeLang(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "en" ? "en" : "zh";
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

async function applyI18n() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const lang = normalizeLang(settings && settings.uiLanguage);
  const dict = {
    zh: {
      title: "LeetCoder Agent",
      sub: "Hot150 / Top Interview 150",
      open_panel: "打开侧边栏",
      open_plan: "打开 Top150 课程页",
      hint: "提示：先打开一次学习计划页，插件才能导入课程结构并同步完成状态。"
    },
    en: {
      title: "LeetCoder Agent",
      sub: "Hot150 / Top Interview 150",
      open_panel: "Open Side Panel",
      open_plan: "Open Top150 Plan",
      hint: "Tip: Open the study plan page once so the extension can import the curriculum and sync your status."
    }
  }[lang];

  document.getElementById("popupTitle").textContent = dict.title;
  document.getElementById("popupSub").textContent = dict.sub;
  document.getElementById("btnOpenPanel").textContent = dict.open_panel;
  document.getElementById("btnOpenPlan").textContent = dict.open_plan;
  document.getElementById("popupHint").textContent = dict.hint;
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

applyI18n().catch(() => {
  // Best-effort i18n: if storage read fails, keep the default English strings.
});
