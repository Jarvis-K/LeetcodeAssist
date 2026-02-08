/* global chrome */

function runtimeSendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message || String(err) });
      resolve(resp);
    });
  });
}

function tabsQuery(query) {
  return new Promise((resolve) => chrome.tabs.query(query, resolve));
}

function tabsSendMessage(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message || String(err) });
      resolve(resp);
    });
  });
}

function storageGetAll() {
  return new Promise((resolve) => chrome.storage.local.get(null, resolve));
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function parseProblemSlugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("problems");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch (e) {
    // ignore
  }
  return "";
}

function parseSiteOriginFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "leetcode.com" || u.hostname.endsWith(".leetcode.com")) return "https://leetcode.com";
    if (u.hostname === "leetcode.cn" || u.hostname.endsWith(".leetcode.cn")) return "https://leetcode.cn";
    return "";
  } catch (e) {
    return "";
  }
}

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node;
}

const state = {
  activeTabId: null,
  currentSlug: "",
  siteOrigin: "https://leetcode.com",
  problem: null,
  course: null,
  progressBySlug: {},
  settings: null,
  attempt: null,
  chat: [],
  pending: false,
  focus: {
    running: false,
    startedAtMs: 0,
    remainingSec: 1500,
    intervalId: null
  }
};

const I18N = {
  zh: {
    tab_course: "课程",
    tab_tutor: "导师",
    tab_review: "代码评审",
    tab_settings: "设置",
    ctx_label: "当前",
    ctx_not_on_problem: "未在题目页",
    btn_refresh: "刷新",
    daily_title: "今日课程",
    daily_streak: "连续: {n}天",
    daily_meta: "到期复习: {due} · 推荐: {next}",
    btn_open_recommended: "打开推荐",
    btn_focus: "专注 {mm}:{ss}",
    btn_reset: "重置",
    btn_open_plan: "打开 Top150 课程页",
    btn_open_next: "打开下一题",
    btn_reload_course: "重新加载课程",
    course_not_imported: "未导入",
    course_import_hint:
      "导入方式：打开 Top Interview 150 学习计划页一次，然后回到这里点“重新加载课程”。插件会抓取并缓存课程结构，并同步你在 LeetCode 的完成/尝试状态。",
    label_stage: "阶段",
    btn_clear: "清空",
    attempt_title: "尝试记录（解锁防剧透）",
    attempt_tried: "我已自己尝试过",
    attempt_save: "保存尝试",
    attempt_locked: "未解锁",
    attempt_unlocked: "已解锁",
    attempt_hint:
      "Spoiler Guard 会阻止 Hint/Pseudocode/Explain，直到你写下尝试思路（>= {n} 字）或勾选“我已自己尝试过”。",
    attempt_placeholder: "写下你的思路/不变量/边界条件（越具体越好）…",
    chat_placeholder: "问一个提示、学习计划或讲解（Ctrl/Cmd+Enter 发送）…",
    btn_hint: "提示",
    btn_plan: "计划",
    btn_pseudo: "伪代码",
    btn_explain: "讲解",
    btn_send: "发送",
    tutor_hint: "导师默认按设置语言输出，并且除非你明确要求，否则不会直接贴完整最终代码。",
    label_review_language: "语言",
    btn_pull_code: "拉取代码",
    review_placeholder: "从编辑器拉取或粘贴你的解法代码…",
    btn_review: "评审",
    btn_review_correctness: "正确性",
    btn_review_complexity: "复杂度",
    btn_review_edge: "边界情况",
    btn_open_item: "打开",
    btn_mark: "标记",
    status_unstarted: "未开始",
    status_in_progress: "进行中",
    status_solved: "已通过",
    status_reviewed: "已复习",
    msg_empty_chat: "还没有消息。",
    msg_thinking: "思考中…",
    msg_paste_code_first: "请先粘贴代码或从编辑器拉取。",
    label_ui_language: "界面语言",
    label_output_language: "导师输出",
    label_spoiler_guard: "Spoiler Guard（防剧透）",
    label_min_attempt: "最少尝试字数",
    settings_configured: "已配置",
    settings_not_configured: "未配置",
    settings_saved: "已保存",
    settings_save_failed: "保存失败",
    settings_testing: "测试中…",
    settings_ok: "OK",
    settings_fail: "失败",
    course_status: "{solved}/{total} 已完成{active}",
    course_active_suffix: "（{n} 进行中）",
    course_lc_suffix: " · LC:{n}",
    course_lc_missing: " · LC状态缺失"
  },
  en: {
    tab_course: "Course",
    tab_tutor: "Tutor",
    tab_review: "Review",
    tab_settings: "Settings",
    ctx_label: "Current",
    ctx_not_on_problem: "Not on a problem",
    btn_refresh: "Refresh",
    daily_title: "Today",
    daily_streak: "Streak: {n}",
    daily_meta: "Due reviews: {due} · Next: {next}",
    btn_open_recommended: "Open Recommended",
    btn_focus: "Focus {mm}:{ss}",
    btn_reset: "Reset",
    btn_open_plan: "Open Top150 Plan",
    btn_open_next: "Open Next",
    btn_reload_course: "Reload Course",
    course_not_imported: "Not imported",
    course_import_hint:
      "Import flow: open the Top Interview 150 study plan page once, then click “Reload Course” here. The extension will cache the curriculum and sync your completion/attempt status.",
    label_stage: "Stage",
    btn_clear: "Clear",
    attempt_title: "Attempt (to unlock spoilers)",
    attempt_tried: "I tried myself",
    attempt_save: "Save Attempt",
    attempt_locked: "Locked",
    attempt_unlocked: "Unlocked",
    attempt_hint:
      "Spoiler Guard blocks Hint/Pseudocode/Explain until you write attempt notes (>= {n} chars) or check “I tried myself”.",
    attempt_placeholder: "Write your approach / invariant / edge cases (be specific)...",
    chat_placeholder: "Ask for a hint, plan, or explanation... (Ctrl/Cmd+Enter to send)",
    btn_hint: "Hint",
    btn_plan: "Plan",
    btn_pseudo: "Pseudocode",
    btn_explain: "Explain",
    btn_send: "Send",
    tutor_hint: "The tutor will follow your language setting and avoid full final code unless you explicitly ask.",
    label_review_language: "Language",
    btn_pull_code: "Pull Code",
    review_placeholder: "Pull from editor or paste your solution code here...",
    btn_review: "Review",
    btn_review_correctness: "Correctness",
    btn_review_complexity: "Complexity",
    btn_review_edge: "Edge cases",
    btn_open_item: "Open",
    btn_mark: "Mark",
    status_unstarted: "unstarted",
    status_in_progress: "in progress",
    status_solved: "solved",
    status_reviewed: "reviewed",
    msg_empty_chat: "No messages yet.",
    msg_thinking: "Thinking...",
    msg_paste_code_first: "Paste code first (or pull from editor).",
    label_ui_language: "UI Language",
    label_output_language: "Tutor Output",
    label_spoiler_guard: "Spoiler Guard",
    label_min_attempt: "Min attempt chars",
    settings_configured: "Configured",
    settings_not_configured: "Not configured",
    settings_saved: "Saved",
    settings_save_failed: "Save failed",
    settings_testing: "Testing...",
    settings_ok: "OK",
    settings_fail: "Fail",
    course_status: "{solved}/{total} solved{active}",
    course_active_suffix: " ({n} active)",
    course_lc_suffix: " · LC:{n}",
    course_lc_missing: " · LC status missing"
  }
};

function normalizeLang(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "en" ? "en" : "zh";
}

function uiLang() {
  return normalizeLang(state.settings && state.settings.uiLanguage);
}

function outLang() {
  return normalizeLang(state.settings && state.settings.outputLanguage);
}

function t(key, vars) {
  const lang = uiLang();
  const dict = I18N[lang] || I18N.zh;
  let s = dict[key] || I18N.en[key] || key;
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

function statusToLabel(s) {
  const v = String(s || "").toLowerCase();
  if (v === "solved") return t("status_solved");
  if (v === "reviewed") return t("status_reviewed");
  if (v === "in_progress") return t("status_in_progress");
  return t("status_unstarted");
}

function cycleStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "unstarted") return "in_progress";
  if (v === "in_progress") return "solved";
  if (v === "solved") return "reviewed";
  return "unstarted";
}

function difficultyClass(d) {
  const v = String(d || "").toLowerCase();
  if (v.includes("easy")) return "easy";
  if (v.includes("hard")) return "hard";
  if (v.includes("medium")) return "medium";
  return "";
}

function statusDotClass(status) {
  const v = String(status || "").toLowerCase();
  if (v === "solved" || v === "reviewed") return "solved";
  if (v === "in_progress") return "in_progress";
  return "";
}

function courseItemStatusClass(status) {
  const v = String(status || "").toLowerCase().trim();
  if (!v) return "";
  // CSS class names can't contain "_".
  return `status-${v.replaceAll("_", "-")}`;
}

function setCtxLabel(text) {
  el("ctxValue").textContent = text;
}

function fmtMmSs(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(Math.floor(sec % 60)).padStart(2, "0");
  return { mm, ss };
}

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function readDaily(dateKey) {
  const key = `daily:${dateKey}`;
  const obj = await storageGet([key]);
  return obj[key] || { date: dateKey, focusSeconds: 0, touchedSlugs: [], updatedAt: new Date().toISOString() };
}

async function addDailyFocus(seconds) {
  const delta = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!delta) return;
  const dateKey = localDateKey();
  const key = `daily:${dateKey}`;
  const cur = await readDaily(dateKey);
  const next = {
    ...cur,
    date: dateKey,
    focusSeconds: Math.max(0, Math.floor(Number(cur.focusSeconds) || 0) + delta),
    updatedAt: new Date().toISOString()
  };
  await storageSet({ [key]: next });
}

async function addDailyTouch(slug) {
  const s = String(slug || "").trim();
  if (!s) return;
  const dateKey = localDateKey();
  const key = `daily:${dateKey}`;
  const cur = await readDaily(dateKey);
  const set = new Set(Array.isArray(cur.touchedSlugs) ? cur.touchedSlugs : []);
  set.add(s);
  const next = { ...cur, date: dateKey, touchedSlugs: Array.from(set), updatedAt: new Date().toISOString() };
  await storageSet({ [key]: next });
}

function computeStreakFromAllStorage(all) {
  const set = new Set();
  for (const [k, v] of Object.entries(all || {})) {
    if (!k.startsWith("daily:")) continue;
    const rec = v || {};
    const touched = Array.isArray(rec.touchedSlugs) ? rec.touchedSlugs.length : 0;
    const focus = Number.isFinite(Number(rec.focusSeconds)) ? Number(rec.focusSeconds) : 0;
    if (touched > 0 || focus > 0) set.add(k.slice("daily:".length));
  }
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = localDateKey(d);
    if (!set.has(key)) break;
    streak += 1;
  }
  return streak;
}

function progressRank(status) {
  const v = String(status || "").toLowerCase();
  if (v === "reviewed") return 3;
  if (v === "solved") return 2;
  if (v === "in_progress") return 1;
  return 0;
}

function applyUiText() {
  // Tabs
  const tabCourse = document.querySelector('.tab[data-tab="course"]');
  const tabTutor = document.querySelector('.tab[data-tab="tutor"]');
  const tabReview = document.querySelector('.tab[data-tab="review"]');
  const tabSettings = document.querySelector('.tab[data-tab="settings"]');
  if (tabCourse) tabCourse.textContent = t("tab_course");
  if (tabTutor) tabTutor.textContent = t("tab_tutor");
  if (tabReview) tabReview.textContent = t("tab_review");
  if (tabSettings) tabSettings.textContent = t("tab_settings");

  const ctxLabel = document.querySelector(".ctxLabel");
  if (ctxLabel) ctxLabel.textContent = t("ctx_label");
  el("btnRefreshCtx").textContent = t("btn_refresh");

  // Daily panel
  el("dailyTitle").textContent = t("daily_title");
  el("btnOpenRecommended").textContent = t("btn_open_recommended");
  el("btnFocusReset").textContent = t("btn_reset");

  // Course page
  el("btnOpenPlan").textContent = t("btn_open_plan");
  el("btnOpenNext").textContent = t("btn_open_next");
  el("btnReloadCourse").textContent = t("btn_reload_course");
  el("courseHint").textContent = t("course_import_hint");

  // Tutor page
  el("labelStage").textContent = t("label_stage");
  el("btnClearChat").textContent = t("btn_clear");
  el("attemptTitle").textContent = t("attempt_title");
  el("attemptTriedLabel").textContent = t("attempt_tried");
  el("btnSaveAttempt").textContent = t("attempt_save");
  el("attemptNotes").setAttribute("placeholder", t("attempt_placeholder"));
  el("chatInput").setAttribute("placeholder", t("chat_placeholder"));
  el("btnQuickHint").textContent = t("btn_hint");
  el("btnQuickPlan").textContent = t("btn_plan");
  el("btnQuickPseudo").textContent = t("btn_pseudo");
  el("btnQuickExplain").textContent = t("btn_explain");
  el("btnSend").textContent = t("btn_send");
  el("tutorHint").textContent = t("tutor_hint");

  // Review page
  el("labelReviewLanguage").textContent = t("label_review_language");
  el("btnPullCode").textContent = t("btn_pull_code");
  el("btnReview").textContent = t("btn_review");
  el("codeInput").setAttribute("placeholder", t("review_placeholder"));
  el("btnReviewCorrectness").textContent = t("btn_review_correctness");
  el("btnReviewComplexity").textContent = t("btn_review_complexity");
  el("btnReviewEdge").textContent = t("btn_review_edge");

  // Settings page
  el("labelUiLanguage").textContent = t("label_ui_language");
  el("labelOutputLanguage").textContent = t("label_output_language");
  el("labelSpoilerGuard").textContent = t("label_spoiler_guard");
  el("labelMinAttemptChars").textContent = t("label_min_attempt");
}

function renderCourse() {
  const course = state.course;
  const list = el("courseList");
  list.innerHTML = "";

  if (!course || !Array.isArray(course.sections) || !course.sections.length) {
    el("courseStatus").textContent = t("course_not_imported");
    el("courseHint").style.display = "block";
    return;
  }

  el("courseHint").style.display = "none";
  const slugs = [];
  const seen = new Set();
  for (const s of course.sections) {
    for (const it of s.items || []) {
      if (!it || !it.slug || seen.has(it.slug)) continue;
      seen.add(it.slug);
      slugs.push(it.slug);
    }
  }
  const total = slugs.length || course.total || 0;
  let solved = 0;
  let inProgress = 0;
  for (const slug of slugs) {
    const st = String(state.progressBySlug[slug]?.status || "unstarted").toLowerCase();
    if (st === "solved" || st === "reviewed") solved += 1;
    else if (st === "in_progress") inProgress += 1;
  }
  const activeSuffix = inProgress ? t("course_active_suffix", { n: inProgress }) : "";
  let lcSuffix = "";
  if (course && course.lcStats && typeof course.lcStats === "object") {
    const lcSolved = Number(course.lcStats.solved || 0);
    const lcUnknown = Number(course.lcStats.unknown || 0);
    if (course.statusSource === "api/problems/all") {
      lcSuffix = t("course_lc_suffix", { n: lcSolved });
    } else if (lcSolved > 0) {
      lcSuffix = t("course_lc_suffix", { n: lcSolved });
    } else if (lcUnknown >= total) {
      lcSuffix = t("course_lc_missing");
    }
  }
  el("courseStatus").textContent = t("course_status", { solved, total, active: activeSuffix }) + lcSuffix;

  for (const section of course.sections) {
    const details = document.createElement("details");
    details.open = false;
    const summary = document.createElement("summary");
    const count = Array.isArray(section.items) ? section.items.length : 0;
    summary.textContent = `${section.title} (${count})`;
    details.appendChild(summary);

    const items = document.createElement("div");
    items.className = "courseItems";

    for (const item of section.items || []) {
      const row = document.createElement("div");
      row.className = "courseItem";

      const left = document.createElement("div");
      left.className = "courseItemLeft";

      const title = document.createElement("div");
      title.className = "courseItemTitle";
      title.textContent = item.title || item.slug;

      const meta = document.createElement("div");
      meta.className = "courseItemMeta";

      const diff = document.createElement("span");
      diff.className = "badge";
      diff.innerHTML = `<span class="badgeDot ${difficultyClass(item.difficulty)}"></span>${item.difficulty || "?"}`;

      const progress = state.progressBySlug[item.slug] || { status: "unstarted" };
      row.classList.add(courseItemStatusClass(progress.status));
      const stat = document.createElement("span");
      stat.className = "badge";
      stat.innerHTML = `<span class="badgeDot ${statusDotClass(progress.status)}"></span>${statusToLabel(
        progress.status
      )}`;

      meta.appendChild(diff);
      meta.appendChild(stat);

      left.appendChild(title);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";

      const btnOpen = document.createElement("button");
      btnOpen.className = "btn btnSmall";
      btnOpen.textContent = t("btn_open_item");
      btnOpen.addEventListener("click", async () => {
        await chrome.tabs.create({ url: `${state.siteOrigin}/problems/${item.slug}/` });
      });

      const btnMark = document.createElement("button");
      btnMark.className = "btn btnSmall btnGhost";
      btnMark.textContent = t("btn_mark");
      btnMark.addEventListener("click", async () => {
        const current = state.progressBySlug[item.slug] || { status: "unstarted" };
        const nextStatus = cycleStatus(current.status);
        const resp = await runtimeSendMessage({
          type: "PATCH_PROGRESS",
          slug: item.slug,
          patch: { status: nextStatus }
        });
        if (resp && resp.ok) {
          state.progressBySlug[item.slug] = resp.progress;
          renderCourse();
          await addDailyTouch(item.slug);
          await refreshDailyPanel();
        }
      });

      right.appendChild(btnOpen);
      right.appendChild(btnMark);

      row.appendChild(left);
      row.appendChild(right);
      items.appendChild(row);
    }

    details.appendChild(items);
    list.appendChild(details);
  }
}

function renderChat() {
  const box = el("chat");
  box.innerHTML = "";

  if (!state.chat.length) {
    const empty = document.createElement("div");
    empty.className = "smallHint";
    empty.textContent = t("msg_empty_chat");
    box.appendChild(empty);
    return;
  }

  for (const m of state.chat) {
    const msg = document.createElement("div");
    msg.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
    const header = document.createElement("div");
    header.className = "msgHeader";
    header.textContent = m.role === "user" ? "You" : "Agent";
    const body = document.createElement("div");
    body.textContent = m.content || "";
    msg.appendChild(header);
    msg.appendChild(body);
    box.appendChild(msg);
  }

  box.scrollTop = box.scrollHeight;
}

async function loadProgressIndex() {
  const all = await storageGetAll();
  const map = {};
  for (const [k, v] of Object.entries(all || {})) {
    if (k.startsWith("progress:")) map[k.slice("progress:".length)] = v;
  }
  state.progressBySlug = map;
}

async function loadCourse() {
  const resp = await runtimeSendMessage({ type: "GET_COURSE", site: state.siteOrigin });
  state.course = resp && resp.ok ? resp.course : null;
}

async function loadContextFromActiveTab() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs && tabs[0] ? tabs[0] : null;
  state.activeTabId = tab && typeof tab.id === "number" ? tab.id : null;
  const url = tab && tab.url ? String(tab.url) : "";
  const origin = parseSiteOriginFromUrl(url);
  if (origin) state.siteOrigin = origin;

  const slug = parseProblemSlugFromUrl(url);
  state.currentSlug = slug;

  if (!slug || !state.activeTabId) {
    state.problem = null;
    setCtxLabel(t("ctx_not_on_problem"));
    return;
  }

  const resp = await tabsSendMessage(state.activeTabId, { type: "CS_GET_PROBLEM_CONTEXT" });
  if (resp && resp.ok) {
    state.problem = resp.problem || { slug };
    const title = state.problem && state.problem.title ? state.problem.title : slug;
    setCtxLabel(`${title} (${slug})`);
  } else {
    state.problem = { slug };
    setCtxLabel(slug);
  }
}

async function loadChatForSlug(slug) {
  const key = slug || "global";
  const resp = await runtimeSendMessage({ type: "GET_CHAT", slug: key });
  state.chat = resp && resp.ok && Array.isArray(resp.chat) ? resp.chat : [];
}

async function loadAttemptForSlug(slug) {
  const s = String(slug || "").trim();
  if (!s || s === "global") {
    state.attempt = null;
    el("attemptPanel").style.display = "none";
    return;
  }
  el("attemptPanel").style.display = "block";
  const resp = await runtimeSendMessage({ type: "ATTEMPT_GET", slug: s });
  state.attempt = resp && resp.ok ? resp.attempt : { slug: s, notes: "", tried: false };
  el("attemptNotes").value = state.attempt.notes || "";
  el("attemptTried").checked = Boolean(state.attempt.tried);
  renderAttemptStatus();
}

function attemptUnlocked() {
  const s = state.settings || {};
  const guard = Boolean(s.spoilerGuard);
  if (!guard) return true;
  const slug = String(state.currentSlug || "").trim();
  if (!slug || slug === "global") return true;
  const minChars = Number.isFinite(Number(s.minAttemptChars)) ? Number(s.minAttemptChars) : 40;
  const tried = Boolean(state.attempt && state.attempt.tried);
  const notesLen = String(state.attempt && state.attempt.notes ? state.attempt.notes : "").trim().length;
  return tried || notesLen >= minChars;
}

function renderAttemptStatus() {
  const s = state.settings || {};
  const minChars = Number.isFinite(Number(s.minAttemptChars)) ? Number(s.minAttemptChars) : 40;
  el("attemptHint").textContent = t("attempt_hint", { n: minChars });

  const unlocked = attemptUnlocked();
  el("attemptStatus").textContent = unlocked ? t("attempt_unlocked") : t("attempt_locked");

  const stageSel = el("stageSelect");
  const blockedStages = new Set(["hint", "pseudocode", "explain"]);
  for (const opt of Array.from(stageSel.options)) {
    if (blockedStages.has(opt.value)) opt.disabled = Boolean(s.spoilerGuard) && !unlocked && Boolean(state.currentSlug);
  }

  const disable = Boolean(s.spoilerGuard) && !unlocked && Boolean(state.currentSlug);
  el("btnQuickHint").disabled = disable;
  el("btnQuickPseudo").disabled = disable;
  el("btnQuickExplain").disabled = disable;
}

function setPending(p) {
  state.pending = Boolean(p);
  el("btnSend").disabled = state.pending;
  el("btnReview").disabled = state.pending;
}

function promptForQuick(kind) {
  const lang = outLang();
  if (lang === "en") {
    if (kind === "hint") return "Give me exactly 1 hint. Do not reveal the full solution.";
    if (kind === "plan") return "Give me a learning plan + checklist before I code.";
    if (kind === "pseudocode") return "Provide pseudocode skeleton + invariants. No full code.";
    if (kind === "explain") return "Explain the solution clearly. Prefer pseudocode unless I ask for code.";
    return "";
  }
  if (kind === "hint") return "给我 1 个提示即可，不要直接泄露完整解法。";
  if (kind === "plan") return "在我写代码前，给我一份学习计划 + 实现 checklist。";
  if (kind === "pseudocode") return "给伪代码骨架 + 不变量，不要给完整最终代码。";
  if (kind === "explain") return "把解法讲清楚，优先给解释 + 伪代码，除非我明确要求才给完整代码。";
  return "";
}

async function sendTutorMessage(userText, stageOverride) {
  if (state.pending) return;

  const text = String(userText || "").trim();
  if (!text) return;

  setPending(true);
  const stage = stageOverride || el("stageSelect").value;
  const slug = state.currentSlug || "global";
  const problem = state.problem
    ? {
        slug: state.problem.slug || slug,
        title: state.problem.title || "",
        difficulty: state.problem.difficulty || "",
        contentText: state.problem.contentText || "",
        tags: state.problem.tags || []
      }
    : { slug };

  const resp = await runtimeSendMessage({
    type: "LLM_CHAT",
    slug,
    stage,
    userMessage: text,
    problem
  });

  if (resp && resp.ok) {
    state.chat = resp.chat || [];
    renderChat();
  } else {
    state.chat = [
      ...state.chat,
      { role: "assistant", content: `Error: ${resp && resp.error ? resp.error : "Unknown error"}` }
    ];
    renderChat();
  }

  setPending(false);
}

async function sendReview(kind) {
  if (state.pending) return;

  const code = String(el("codeInput").value || "").trim();
  if (!code) {
    el("reviewOutput").textContent = t("msg_paste_code_first");
    return;
  }

  const lang = el("langSelect").value;
  const ol = outLang();
  let userMessage =
    ol === "en"
      ? "Review my code for correctness, complexity, and edge cases. Be concrete."
      : "请评审我的代码：正确性、复杂度、边界条件。给出具体问题与改法。";
  if (kind === "correctness")
    userMessage =
      ol === "en"
        ? "Review my code for correctness. Find counterexamples and bugs."
        : "只从正确性角度评审：找反例、找 bug、指出错误不变量。";
  if (kind === "complexity")
    userMessage =
      ol === "en"
        ? "Review my code focusing on time/space complexity and possible optimizations."
        : "只从复杂度角度评审：时间/空间复杂度、可优化点与取舍。";
  if (kind === "edge")
    userMessage =
      ol === "en"
        ? "Review my code focusing on tricky edge cases and invariant violations."
        : "只从边界情况角度评审：极端输入、空/重复、溢出、循环不变式是否被破坏。";

  setPending(true);
  el("reviewOutput").textContent = t("msg_thinking");

  const slug = state.currentSlug || "global";
  const problem = state.problem
    ? {
        slug: state.problem.slug || slug,
        title: state.problem.title || "",
        difficulty: state.problem.difficulty || "",
        contentText: state.problem.contentText || "",
        tags: state.problem.tags || []
      }
    : { slug };

  const resp = await runtimeSendMessage({
    type: "LLM_CHAT",
    slug,
    stage: "review",
    userMessage,
    problem,
    code,
    language: lang
  });

  if (resp && resp.ok) {
    el("reviewOutput").textContent = resp.assistant || "";
    // Keep chat in sync too.
    state.chat = resp.chat || state.chat;
    renderChat();
  } else {
    el("reviewOutput").textContent = `Error: ${resp && resp.error ? resp.error : "Unknown error"}`;
  }

  setPending(false);
}

async function loadSettingsIntoForm() {
  const resp = await runtimeSendMessage({ type: "SETTINGS_GET" });
  const s = resp && resp.ok ? resp.settings : null;
  if (!s) return;
  state.settings = s;

  el("setBaseUrl").value = s.baseUrl || "";
  el("setApiKey").value = s.apiKey || "";
  el("setModel").value = s.model || "";
  el("setTemp").value = String(typeof s.temperature === "number" ? s.temperature : 0.2);
  el("setMaxTokens").value = String(typeof s.maxTokens === "number" ? s.maxTokens : 800);
  el("setUiLanguage").value = normalizeLang(s.uiLanguage);
  el("setOutputLanguage").value = normalizeLang(s.outputLanguage);
  el("setSpoilerGuard").checked = Boolean(s.spoilerGuard);
  el("setMinAttemptChars").value = String(Number.isFinite(Number(s.minAttemptChars)) ? Number(s.minAttemptChars) : 40);

  const configured = Boolean((s.baseUrl || "").trim()) && Boolean((s.model || "").trim());
  el("settingsStatus").textContent = configured ? t("settings_configured") : t("settings_not_configured");

  applyUiText();
  renderAttemptStatus();
}

async function saveSettingsFromForm() {
  const baseUrl = String(el("setBaseUrl").value || "").trim();
  const apiKey = String(el("setApiKey").value || "").trim();
  const model = String(el("setModel").value || "").trim();
  const temperature = Number(el("setTemp").value);
  const maxTokens = Number(el("setMaxTokens").value);
  const uiLanguage = normalizeLang(el("setUiLanguage").value);
  const outputLanguage = normalizeLang(el("setOutputLanguage").value);
  const spoilerGuard = Boolean(el("setSpoilerGuard").checked);
  const minAttemptChars = Number(el("setMinAttemptChars").value);

  const resp = await runtimeSendMessage({
    type: "SETTINGS_SET",
    settings: {
      baseUrl,
      apiKey,
      model,
      temperature: Number.isFinite(temperature) ? temperature : 0.2,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 800,
      uiLanguage,
      outputLanguage,
      spoilerGuard,
      minAttemptChars: Number.isFinite(minAttemptChars) ? Math.max(0, Math.floor(minAttemptChars)) : 40
    }
  });

  if (resp && resp.ok) {
    state.settings = resp.settings || state.settings;
    el("settingsStatus").textContent = t("settings_saved");
    applyUiText();
    renderAttemptStatus();
  } else {
    el("settingsStatus").textContent = t("settings_save_failed");
  }
}

function bindTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const pages = Array.from(document.querySelectorAll(".page"));
  for (const t of tabs) {
    t.addEventListener("click", () => {
      const name = t.getAttribute("data-tab");
      for (const x of tabs) x.classList.toggle("isActive", x === t);
      for (const p of pages) p.classList.toggle("isActive", p.getAttribute("data-page") === name);
    });
  }
}

function courseSlugsInOrder(course) {
  const out = [];
  const seen = new Set();
  if (!course || !Array.isArray(course.sections)) return out;
  for (const section of course.sections) {
    for (const it of section.items || []) {
      const slug = it && it.slug ? String(it.slug).trim() : "";
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

function computeDueReviews(slugs) {
  const now = Date.now();
  const due = [];
  for (const slug of slugs) {
    const p = state.progressBySlug[slug];
    if (!p) continue;
    const st = String(p.status || "unstarted").toLowerCase();
    if (!(st === "solved" || st === "reviewed")) continue;
    if (!p.nextReviewAt) continue;
    const tMs = Date.parse(p.nextReviewAt);
    if (!Number.isFinite(tMs)) continue;
    if (tMs <= now) due.push({ slug, at: tMs });
  }
  due.sort((a, b) => a.at - b.at);
  return due;
}

function pickRecommendedSlug() {
  const slugs = courseSlugsInOrder(state.course);
  if (!slugs.length) return "";

  const due = computeDueReviews(slugs);
  if (due.length) return due[0].slug;

  // Prefer continuing in-progress before starting a new one.
  for (const slug of slugs) {
    const st = String(state.progressBySlug[slug]?.status || "unstarted").toLowerCase();
    if (st === "in_progress") return slug;
  }
  for (const slug of slugs) {
    const st = String(state.progressBySlug[slug]?.status || "unstarted").toLowerCase();
    if (st === "unstarted") return slug;
  }
  return slugs[0] || "";
}

function slugTitle(slug) {
  const s = String(slug || "").trim();
  if (!s || !state.course || !Array.isArray(state.course.sections)) return s;
  for (const section of state.course.sections) {
    for (const it of section.items || []) {
      if (it && it.slug === s) return it.title || s;
    }
  }
  return s;
}

async function refreshDailyPanel() {
  const slugs = courseSlugsInOrder(state.course);
  const due = computeDueReviews(slugs);
  const rec = pickRecommendedSlug();

  const all = await storageGetAll();
  const streak = computeStreakFromAllStorage(all);
  el("dailyStreak").textContent = t("daily_streak", { n: streak });

  const nextLabel = rec ? `${slugTitle(rec)} (${rec})` : "-";
  el("dailyMeta").textContent = t("daily_meta", { due: due.length, next: nextLabel });

  const { mm, ss } = fmtMmSs(state.focus.remainingSec);
  el("btnFocusToggle").textContent = t("btn_focus", { mm, ss });
}

function stopFocusTimer() {
  if (state.focus.intervalId) clearInterval(state.focus.intervalId);
  state.focus.intervalId = null;
  state.focus.running = false;
  state.focus.startedAtMs = 0;
}

async function startOrPauseFocusTimer() {
  if (state.focus.running) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - state.focus.startedAtMs) / 1000));
    // Remaining is updated every tick, but guard against stalls.
    state.focus.remainingSec = Math.max(0, state.focus.remainingSec);
    stopFocusTimer();
    await addDailyFocus(elapsedSec);
    await refreshDailyPanel();
    return;
  }

  state.focus.running = true;
  state.focus.startedAtMs = Date.now();
  state.focus.intervalId = setInterval(async () => {
    state.focus.remainingSec = Math.max(0, state.focus.remainingSec - 1);
    const { mm, ss } = fmtMmSs(state.focus.remainingSec);
    el("btnFocusToggle").textContent = t("btn_focus", { mm, ss });
    if (state.focus.remainingSec <= 0) {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - state.focus.startedAtMs) / 1000));
      stopFocusTimer();
      await addDailyFocus(elapsedSec);
      await refreshDailyPanel();
    }
  }, 1000);
}

function bindActions() {
  el("btnOpenPlan").addEventListener("click", async () => {
    await chrome.tabs.create({ url: `${state.siteOrigin}/studyplan/top-interview-150/` });
  });

  el("btnOpenNext").addEventListener("click", async () => {
    const rec = pickRecommendedSlug();
    if (!rec) return;
    await addDailyTouch(rec);
    await chrome.tabs.create({ url: `${state.siteOrigin}/problems/${rec}/` });
  });

  el("btnOpenRecommended").addEventListener("click", async () => {
    const rec = pickRecommendedSlug();
    if (!rec) return;
    await addDailyTouch(rec);
    await chrome.tabs.create({ url: `${state.siteOrigin}/problems/${rec}/` });
  });

  el("btnFocusToggle").addEventListener("click", async () => startOrPauseFocusTimer());
  el("btnFocusReset").addEventListener("click", async () => {
    stopFocusTimer();
    state.focus.remainingSec = 1500;
    await refreshDailyPanel();
  });

  el("btnReloadCourse").addEventListener("click", async () => {
    // If the active tab is the studyplan page, trigger a fresh import (includes LeetCode completion state).
    if (state.activeTabId) {
      await tabsSendMessage(state.activeTabId, { type: "CS_FORCE_COURSE_IMPORT" });
    }
    await loadProgressIndex();
    await loadCourse();
    renderCourse();
    await refreshDailyPanel();
  });

  el("btnRefreshCtx").addEventListener("click", async () => {
    await loadContextFromActiveTab();
    await loadChatForSlug(state.currentSlug || "global");
    await loadAttemptForSlug(state.currentSlug || "global");
    renderChat();
  });

  el("btnSend").addEventListener("click", async () => {
    const text = el("chatInput").value;
    el("chatInput").value = "";
    await sendTutorMessage(text);
  });

  el("chatInput").addEventListener("keydown", async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const text = el("chatInput").value;
      el("chatInput").value = "";
      await sendTutorMessage(text);
    }
  });

  el("btnQuickHint").addEventListener("click", async () => {
    el("stageSelect").value = "hint";
    await sendTutorMessage(promptForQuick("hint"), "hint");
  });

  el("btnQuickPlan").addEventListener("click", async () => {
    el("stageSelect").value = "plan";
    await sendTutorMessage(promptForQuick("plan"), "plan");
  });

  el("btnQuickPseudo").addEventListener("click", async () => {
    el("stageSelect").value = "pseudocode";
    await sendTutorMessage(promptForQuick("pseudocode"), "pseudocode");
  });

  el("btnQuickExplain").addEventListener("click", async () => {
    el("stageSelect").value = "explain";
    await sendTutorMessage(promptForQuick("explain"), "explain");
  });

  el("btnClearChat").addEventListener("click", async () => {
    const slug = state.currentSlug || "global";
    await runtimeSendMessage({ type: "CLEAR_CHAT", slug });
    state.chat = [];
    renderChat();
  });

  el("btnReview").addEventListener("click", async () => sendReview("all"));
  el("btnReviewCorrectness").addEventListener("click", async () => sendReview("correctness"));
  el("btnReviewComplexity").addEventListener("click", async () => sendReview("complexity"));
  el("btnReviewEdge").addEventListener("click", async () => sendReview("edge"));

  el("btnPullCode").addEventListener("click", async () => {
    if (!state.activeTabId) return;
    const resp = await tabsSendMessage(state.activeTabId, { type: "CS_GET_EDITOR_CODE" });
    if (resp && resp.ok && resp.code) {
      el("codeInput").value = resp.code;
      if (resp.language) {
        const lang = String(resp.language).toLowerCase();
        const opt = Array.from(el("langSelect").options).find((o) => o.value === lang);
        if (opt) el("langSelect").value = lang;
      }
    } else {
      const msg = resp && resp.error ? resp.error : "Failed to pull code.";
      el("reviewOutput").textContent = msg;
    }
  });

  el("btnSaveAttempt").addEventListener("click", async () => {
    const slug = state.currentSlug || "";
    if (!slug) return;
    const notes = String(el("attemptNotes").value || "");
    const tried = Boolean(el("attemptTried").checked);
    const resp = await runtimeSendMessage({ type: "ATTEMPT_SET", slug, patch: { notes, tried } });
    if (resp && resp.ok) {
      state.attempt = resp.attempt;
      renderAttemptStatus();
      await addDailyTouch(slug);
      await refreshDailyPanel();
    }
  });

  el("btnSaveSettings").addEventListener("click", async () => saveSettingsFromForm());
  el("btnTestSettings").addEventListener("click", async () => {
    el("settingsStatus").textContent = t("settings_testing");
    const resp = await runtimeSendMessage({
      type: "LLM_CHAT",
      slug: "global",
      stage: "hint",
      userMessage: outLang() === "en" ? "Just reply with: ok" : "只回复：ok",
      problem: { slug: "global" }
    });
    if (resp && resp.ok) {
      el("settingsStatus").textContent = t("settings_ok");
    } else {
      el("settingsStatus").textContent = t("settings_fail");
    }
  });

  el("setUiLanguage").addEventListener("change", async () => {
    // Optimistic UI switch without saving.
    state.settings = { ...(state.settings || {}), uiLanguage: normalizeLang(el("setUiLanguage").value) };
    applyUiText();
    renderAttemptStatus();
    renderCourse();
    renderChat();
    await refreshDailyPanel();
  });
}

async function init() {
  bindTabs();
  bindActions();

  await loadSettingsIntoForm();

  await loadProgressIndex();
  await loadContextFromActiveTab();
  await loadCourse();
  renderCourse();
  await refreshDailyPanel();

  await loadChatForSlug(state.currentSlug || "global");
  await loadAttemptForSlug(state.currentSlug || "global");
  renderChat();

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;
    if (changes["course:top-interview-150"] || changes[`course:top-interview-150:${state.siteOrigin}`]) {
      await loadProgressIndex();
      await loadCourse();
      renderCourse();
      await refreshDailyPanel();
    }
    // Progress changes affect badges + due reviews.
    if (Object.keys(changes).some((k) => k.startsWith("progress:"))) {
      await loadProgressIndex();
      renderCourse();
      await refreshDailyPanel();
    }
  });
}

init().catch((e) => {
  setCtxLabel(`Init error: ${String(e && e.message ? e.message : e)}`);
});
