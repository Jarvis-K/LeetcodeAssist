/* global chrome */

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function storageGetAll() {
  return new Promise((resolve) => chrome.storage.local.get(null, resolve));
}

async function getSettings() {
  const { settings } = await storageGet(["settings"]);
  return {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.2,
    maxTokens: 800,
    outputLanguage: "zh", // "zh" | "en"
    uiLanguage: "zh", // "zh" | "en"
    spoilerGuard: true,
    minAttemptChars: 40,
    memoryEnabled: true,
    memoryAutoCurate: true,
    adaptiveRecommend: true,
    ...(settings || {})
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStage(stage) {
  const s = String(stage || "").toLowerCase().trim();
  if (["plan", "hint", "pseudocode", "explain", "review", "postmortem"].includes(s)) return s;
  return "hint";
}

function normalizeOutputLanguage(lang) {
  const v = String(lang || "").toLowerCase().trim();
  if (v === "en" || v === "english") return "en";
  return "zh";
}

function normalizeBool(v, fallback) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (["true", "1", "yes", "y", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "off"].includes(s)) return false;
  }
  if (typeof v === "number") return v !== 0;
  return Boolean(fallback);
}

function normalizeMemoryText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function upsertMemoryList(list, items, nowIsoStr, limit) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const byKey = new Map();
  for (const it of arr) {
    if (!it || typeof it.text !== "string") continue;
    byKey.set(normalizeMemoryText(it.text).toLowerCase(), { ...it });
  }
  for (const raw of Array.isArray(items) ? items : []) {
    const text = normalizeMemoryText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    const prev = byKey.get(key);
    byKey.set(key, {
      text,
      count: prev && Number.isFinite(Number(prev.count)) ? Number(prev.count) + 1 : 1,
      lastAt: nowIsoStr
    });
  }
  const merged = Array.from(byKey.values());
  merged.sort((a, b) => {
    const ca = Number.isFinite(Number(a.count)) ? Number(a.count) : 0;
    const cb = Number.isFinite(Number(b.count)) ? Number(b.count) : 0;
    if (cb !== ca) return cb - ca;
    return String(b.lastAt || "").localeCompare(String(a.lastAt || ""));
  });
  return merged.slice(0, Math.max(0, limit || 10));
}

function buildSystemPrompt(stage, settings) {
  const lang = normalizeOutputLanguage(settings?.outputLanguage);
  const languageLine =
    lang === "en"
      ? "Default language: English. Always reply in English unless the user explicitly asks for Chinese."
      : "Default language: Chinese (简体中文). Always reply in Chinese unless the user explicitly asks for English.";

  const commonEn = [
    "You are a LeetCode tutor agent helping the user learn in a course-like, immersive way.",
    languageLine,
    "Be precise and pragmatic. Prefer patterns, invariants, and edge cases.",
    "Unless the user explicitly asks for the full final code, avoid dumping a complete working solution; give incremental guidance instead.",
    "If information is missing (constraints, input format), ask 1-3 targeted questions before committing to an approach."
  ];

  const commonZh = [
    "你是一个 LeetCode 导师型 agent，目标是把刷题过程做成课程化、沉浸式学习。",
    languageLine,
    "表达要准确务实，优先讲清：题型/套路、关键不变量、边界条件。",
    "除非用户明确要求给出完整最终代码，否则不要一次性把完整可运行解法全部贴出来；请用分步引导的方式推进。",
    "如果信息不足（约束、输入格式），先问 1-3 个关键澄清问题再给方案。"
  ];

  const stageRulesEn = {
    plan: [
      "Goal: produce a structured learning plan for this problem.",
      "Output format: 1) Key idea/pattern 2) Step-by-step approach 3) Complexity 4) Common pitfalls 5) A small implementation checklist."
    ],
    hint: [
      "Goal: provide up to 3 progressive hints.",
      "Do not reveal the full solution at once. Prefer questions that guide the user to the next step."
    ],
    pseudocode: [
      "Goal: provide pseudocode skeleton and invariants.",
      "Avoid language-specific full code; keep it as pseudocode + key data structures."
    ],
    explain: [
      "Goal: explain the full solution clearly.",
      "Only provide final code if the user explicitly requests it; otherwise provide explanation + pseudocode."
    ],
    review: [
      "Goal: review the user's code for correctness, complexity, edge cases, and clarity.",
      "Call out likely bugs and provide minimal diffs or concrete fixes."
    ],
    postmortem: [
      "Goal: help the user consolidate learning.",
      "Ask 3-5 reflection questions and propose spaced-review prompts and variants."
    ]
  };

  const stageRulesZh = {
    plan: [
      "目标：给出这道题的结构化学习计划。",
      "输出格式：1）核心套路/模式 2）分步做法 3）复杂度 4）常见坑 5）实现前 checklist。"
    ],
    hint: [
      "目标：最多给 3 个逐步递进的提示。",
      "不要一次性泄露完整解法；更偏向用问题引导用户自己走到下一步。"
    ],
    pseudocode: [
      "目标：给伪代码骨架 + 关键不变量。",
      "避免直接给某种语言的完整代码，保持伪代码 + 数据结构/关键步骤即可。"
    ],
    explain: [
      "目标：把完整解法讲清楚。",
      "只有当用户明确要求时才给完整最终代码；否则以解释 + 伪代码为主。"
    ],
    review: [
      "目标：评审用户代码的正确性、复杂度、边界条件与可读性。",
      "指出可能的 bug/反例，并给出最小修改建议。"
    ],
    postmortem: [
      "目标：帮助用户复盘巩固。",
      "给出 3-5 个反思问题，并建议间隔复习点和变体题。"
    ]
  };

  const common = lang === "en" ? commonEn : commonZh;
  const stageRules = lang === "en" ? stageRulesEn : stageRulesZh;

  return [...common, ...(stageRules[stage] || stageRules.hint)].join("\n");
}

function compactHistory(history, maxMessages) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const trimmed = history.slice(-Math.max(0, maxMessages));
  return trimmed
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));
}

async function callChatCompletions({ baseUrl, apiKey, model, temperature, maxTokens, messages }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 2000)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`LLM response is not JSON: ${text.slice(0, 2000)}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM response missing choices[0].message.content");
  }
  return { content, raw: json };
}

async function getChatKey(slug) {
  return `chat:${slug}`;
}

async function readChat(slug) {
  const key = await getChatKey(slug);
  const obj = await storageGet([key]);
  return Array.isArray(obj[key]) ? obj[key] : [];
}

async function writeChat(slug, chat) {
  const key = await getChatKey(slug);
  await storageSet({ [key]: chat });
}

async function appendChat(slug, messages) {
  const chat = await readChat(slug);
  const next = [...chat, ...messages].slice(-40); // keep bounded
  await writeChat(slug, next);
  return next;
}

async function readProgress(slug) {
  const key = `progress:${slug}`;
  const obj = await storageGet([key]);
  return obj[key] || { slug, status: "unstarted", updatedAt: nowIso() };
}

function addDaysIso(iso, days) {
  const d = iso ? new Date(iso) : new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function normalizeStatus(status) {
  const v = String(status || "").toLowerCase().trim();
  if (["unstarted", "in_progress", "solved", "reviewed"].includes(v)) return v;
  return "unstarted";
}

function lcStateToProgressStatus(lcState) {
  const s = String(lcState || "").toLowerCase().trim();
  if (!s) return "";
  // Important: handle "notac" before "ac".
  if (["notac", "wrong", "wa"].some((x) => s.includes(x))) {
    return "in_progress";
  }
  if (s === "ac" || ["accepted", "solved", "done", "completed", "complete", "passed", "finish", "finished"].some((x) => s.includes(x))) {
    return "solved";
  }
  if (["attempted", "tried", "in_progress", "progress", "started"].some((x) => s.includes(x))) return "in_progress";
  if (["todo", "unstarted", "not_started"].some((x) => s.includes(x))) return "unstarted";
  return "";
}

function applyProgressPatch(current, patch) {
  const now = nowIso();
  const reset = Boolean(patch && patch.reset === true);
  const status = normalizeStatus(patch && patch.status ? patch.status : current.status);

  const next = { ...current, ...(patch || {}), status, updatedAt: now };
  if (reset) {
    delete next.solvedAt;
    delete next.startedAt;
    delete next.lastReviewedAt;
    delete next.nextReviewAt;
    next.reviewCount = 0;
    return next;
  }

  if (status === "in_progress") {
    if (!next.startedAt) next.startedAt = now;
  }

  if (status === "solved") {
    if (!next.solvedAt) next.solvedAt = now;
    next.reviewCount = 0;
    next.nextReviewAt = addDaysIso(now, 1);
  }

  if (status === "reviewed") {
    // Each "reviewed" mark counts as a spaced repetition step.
    const schedule = [3, 7, 14, 30, 60];
    const prevCount = Number.isFinite(Number(current.reviewCount)) ? Number(current.reviewCount) : 0;
    const nextCount = prevCount + 1;
    next.reviewCount = nextCount;
    next.lastReviewedAt = now;
    const days = schedule[Math.min(nextCount - 1, schedule.length - 1)];
    next.nextReviewAt = addDaysIso(now, days);
    if (!next.solvedAt) next.solvedAt = now;
  }

  return next;
}

async function patchProgress(slug, patch) {
  const key = `progress:${slug}`;
  const current = await readProgress(slug);
  const next = applyProgressPatch({ ...current, slug }, patch || {});
  await storageSet({ [key]: next });
  return next;
}

async function readAttempt(slug) {
  const key = `attempt:${slug}`;
  const obj = await storageGet([key]);
  return obj[key] || { slug, notes: "", tried: false, updatedAt: nowIso() };
}

async function patchAttempt(slug, patch) {
  const key = `attempt:${slug}`;
  const current = await readAttempt(slug);
  const next = { ...current, ...(patch || {}), slug, updatedAt: nowIso() };
  await storageSet({ [key]: next });
  return next;
}

async function readUserMemory() {
  const obj = await storageGet(["memory:user"]);
  const mem = obj["memory:user"];
  if (mem && typeof mem === "object") return mem;
  return { version: 1, createdAt: nowIso(), updatedAt: nowIso(), summary: "", strengths: [], weaknesses: [], bottlenecks: [], mastered: [], topics: {} };
}

async function writeUserMemory(mem) {
  const next = { ...(mem || {}), version: 1, updatedAt: nowIso() };
  await storageSet({ "memory:user": next });
  return next;
}

async function appendMemoryEvent(event) {
  const key = "memory:events";
  const obj = await storageGet([key]);
  const cur = Array.isArray(obj[key]) ? obj[key] : [];
  const next = [...cur, event].slice(-200);
  await storageSet({ [key]: next });
  return next;
}

async function clearAllMemory() {
  const all = await storageGetAll();
  const keys = Object.keys(all || {}).filter((k) => k === "memory:user" || k.startsWith("memory:"));
  if (keys.length) await storageRemove(keys);
  return keys.length;
}

async function getCourseForSite(site) {
  const s = String(site || "").trim();
  const keys = ["course:top-interview-150"];
  if (s) keys.unshift(`course:top-interview-150:${s}`);
  const obj = await storageGet(keys);
  return s ? obj[`course:top-interview-150:${s}`] || obj["course:top-interview-150"] : obj["course:top-interview-150"];
}

function collectCourseItems(course) {
  const out = [];
  if (!course || !Array.isArray(course.sections)) return out;
  for (const sec of course.sections) {
    for (const it of sec.items || []) out.push(it);
  }
  return out;
}

function uniqueSlugsFromCourse(course) {
  const items = collectCourseItems(course);
  const seen = new Set();
  const slugs = [];
  for (const it of items) {
    const slug = it && it.slug ? String(it.slug).trim() : "";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function computeCourseLcStats(course) {
  const stats = { solved: 0, in_progress: 0, unstarted: 0, unknown: 0 };
  const items = collectCourseItems(course);
  for (const it of items) {
    const s = String(it && it.lcState ? it.lcState : "").toLowerCase().trim();
    if (s === "solved") stats.solved += 1;
    else if (s === "in_progress") stats.in_progress += 1;
    else if (s === "unstarted") stats.unstarted += 1;
    else stats.unknown += 1;
  }
  return stats;
}

function buildSlugStatusMapFromAllProblemsApi(json) {
  const map = new Map();
  const pairs = Array.isArray(json && json.stat_status_pairs) ? json.stat_status_pairs : [];
  for (const p of pairs) {
    const slug = p?.stat?.question__title_slug;
    if (typeof slug !== "string" || !slug.trim()) continue;
    const status = p?.status; // "ac" | "notac" | null
    const s = typeof status === "string" ? status.toLowerCase().trim() : "";
    if (s === "ac") map.set(slug, "solved");
    else if (s === "notac") map.set(slug, "in_progress");
    else map.set(slug, "unstarted");
  }
  return map;
}

function applyLcStatusMapToCourse(course, statusMap, statusSource) {
  if (!course || !Array.isArray(course.sections) || !statusMap || typeof statusMap.get !== "function") return course;
  for (const sec of course.sections) {
    for (const it of sec.items || []) {
      const slug = it && it.slug ? String(it.slug).trim() : "";
      if (!slug) continue;
      const st = statusMap.get(slug);
      if (st) it.lcState = st;
    }
  }
  course.statusSource = statusSource || String(course.statusSource || "").trim() || "api/problems/all";
  course.statusFetchedAt = nowIso();
  course.lcStats = computeCourseLcStats(course);
  return course;
}

function shouldBackfillLcStatus(course) {
  if (!course) return false;
  if (String(course.statusSource || "") === "api/problems/all") return false;
  const slugs = uniqueSlugsFromCourse(course);
  const total = slugs.length || Number(course.total || 0) || 0;
  if (!total) return false;
  const lcStats = course.lcStats && typeof course.lcStats === "object" ? course.lcStats : computeCourseLcStats(course);
  const unknown = Number(lcStats.unknown || 0);
  // If basically everything is unknown, try a more privileged fetch from the page context.
  return unknown >= total;
}

function executeScriptMainWorld(tabId, func, args) {
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          world: "MAIN",
          func,
          args: Array.isArray(args) ? args : []
        },
        (results) => {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, error: err.message || String(err) });
          const r = Array.isArray(results) && results[0] ? results[0].result : null;
          resolve({ ok: true, result: r });
        }
      );
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
}

async function fetchAllProblemsApiFromTab(tabId) {
  // Run fetch in the page's main world to maximize cookie/client-hint compatibility (not the extension context).
  function mainWorldFetchAllProblems() {
    return (async () => {
      try {
        const paths = ["/api/problems/all/", "/api/problems/algorithms/"];
        for (const path of paths) {
          const res = await fetch(path, { method: "GET", credentials: "include" });
          if (!res.ok) continue;
          const json = await res.json();
          if (json && Array.isArray(json.stat_status_pairs)) return { ok: true, path, json };
        }
        return { ok: false, error: "No stat_status_pairs" };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    })();
  }

  const out = await executeScriptMainWorld(tabId, mainWorldFetchAllProblems, []);
  if (!out.ok) return { ok: false, error: out.error || "executeScript failed" };
  if (!out.result || typeof out.result !== "object") return { ok: false, error: "Missing executeScript result" };
  if (!out.result.ok) return { ok: false, error: out.result.error || "fetch failed" };
  return { ok: true, path: out.result.path, json: out.result.json };
}

async function upgradeLocalProgressFromCourse(course) {
  // Import completion state into local progress if user hasn't tracked it yet.
  // Rule: never downgrade an existing state; only upgrade unstarted/in_progress based on LeetCode state.
  const items = collectCourseItems(course);
  const slugs = uniqueSlugsFromCourse(course);
  const keys = slugs.map((s) => `progress:${s}`);
  const existing = keys.length ? await storageGet(keys) : {};
  const updates = {};
  for (const it of items) {
    const slug = it && it.slug ? String(it.slug).trim() : "";
    if (!slug) continue;
    const key = `progress:${slug}`;
    const cur = existing[key] || { slug, status: "unstarted", updatedAt: nowIso() };
    const curStatus = normalizeStatus(cur.status);
    if (curStatus === "reviewed") continue;
    const fromLc = lcStateToProgressStatus(it.lcState || it.lcStatus || it.state || it.status);
    if (!fromLc) continue;
    if (fromLc === "unstarted") continue;

    // Upgrade logic.
    if (fromLc === "solved" && (curStatus === "unstarted" || curStatus === "in_progress")) {
      updates[key] = applyProgressPatch(cur, { status: "solved" });
    } else if (fromLc === "in_progress" && curStatus === "unstarted") {
      updates[key] = applyProgressPatch(cur, { status: "in_progress" });
    }
  }
  if (Object.keys(updates).length) {
    await storageSet(updates);
  }
  return Object.keys(updates).length;
}

async function topicForSlug(slug, site) {
  const s = String(slug || "").trim();
  if (!s) return "";
  const course = await getCourseForSite(site);
  if (!course || !Array.isArray(course.sections)) return "";
  for (const sec of course.sections) {
    for (const it of sec.items || []) {
      if (it && it.slug === s) return String(sec.title || "").trim();
    }
  }
  return "";
}

async function bumpTopicStat({ site, slug, stage, deltaKey }) {
  const settings = await getSettings();
  if (!normalizeBool(settings.memoryEnabled, true)) return;
  const s = String(slug || "").trim();
  if (!s || s === "global") return;
  const topic = await topicForSlug(s, site);
  if (!topic) return;

  const mem = await readUserMemory();
  const topics = mem.topics && typeof mem.topics === "object" ? { ...mem.topics } : {};
  const cur = topics[topic] && typeof topics[topic] === "object" ? { ...topics[topic] } : {};
  cur[deltaKey] = (Number.isFinite(Number(cur[deltaKey])) ? Number(cur[deltaKey]) : 0) + 1;
  cur.lastAt = nowIso();
  topics[topic] = cur;
  await writeUserMemory({ ...mem, topics });

  await appendMemoryEvent({
    at: nowIso(),
    slug: s,
    topic,
    stage: String(stage || ""),
    type: deltaKey
  });
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

async function curateMemoryWithLLM({ settings, mem, context }) {
  const lang = normalizeOutputLanguage(settings?.outputLanguage);
  const sys =
    lang === "en"
      ? [
          "You are a memory curator for a LeetCode tutoring agent.",
          "Task: update the user's learning profile based on the latest interaction.",
          "Return ONLY valid JSON. No markdown. No code fences.",
          "Do NOT include problem statement or full code. Keep it high-level and privacy-preserving.",
          "Limit each list to <= 6 short items (<= 12 words each).",
          "Output schema: { summary: string, strengths: string[], weaknesses: string[], bottlenecks: string[], mastered: string[] }"
        ].join("\n")
      : [
          "你是 LeetCode 导师 agent 的“记忆整理员”。",
          "任务：根据最新一次交互，更新用户的学习画像（强项/弱项/瓶颈/已掌握）。",
          "只返回严格 JSON，不要 markdown，不要代码块。",
          "不要记录题目原文或完整代码，只保留高层信息，注意隐私。",
          "每个列表最多 6 条，每条尽量短（<= 12 个词/字）。",
          "输出结构: { summary: string, strengths: string[], weaknesses: string[], bottlenecks: string[], mastered: string[] }"
        ].join("\n");

  const user = [
    `Current memory summary:\n${String(mem.summary || "").slice(0, 800)}`,
    "",
    "Latest interaction:",
    JSON.stringify(context || {}, null, 2)
  ].join("\n");

  const out = await callChatCompletions({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: 0,
    maxTokens: Math.min(400, Math.max(150, Math.floor(Number(settings.maxTokens || 800) / 4))),
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  return extractJsonObject(out.content);
}

function spoilerGuardBlockMessage(settings) {
  const lang = normalizeOutputLanguage(settings?.outputLanguage);
  const minChars = Number.isFinite(Number(settings?.minAttemptChars)) ? Number(settings.minAttemptChars) : 40;
  if (lang === "en") {
    return [
      "Spoiler Guard is ON, so I won't provide hints/pseudocode/explanations yet.",
      "",
      "To unlock:",
      `1) Write your own attempt notes here (>= ${minChars} chars), OR check “I tried myself”.`,
      "2) Then ask again for a hint/pseudocode/explain.",
      "",
      "Quick prompts for your attempt notes:",
      "- What pattern do you suspect (two pointers / sliding window / DP / monotonic stack / BFS/DFS / greedy)?",
      "- What invariant would make the approach correct?",
      "- What edge case are you stuck on?"
    ].join("\n");
  }
  return [
    "已开启 Spoiler Guard，我会先不直接给出 Hint/Pseudocode/Explain（防剧透）。",
    "",
    "解锁方式（二选一即可）：",
    `1）在侧边栏写下你的“尝试思路”（>= ${minChars} 字）；或`,
    "2）勾选“我已经自己尝试过”。",
    "",
    "你可以先写下这些信息：",
    "• 你觉得像哪类题型/模板（双指针/滑窗/DP/单调栈/图 BFS-DFS/贪心…）？",
    "• 你打算维护什么不变量（invariant）？",
    "• 卡住的边界条件是什么？"
  ].join("\n");
}

chrome.runtime.onInstalled.addListener(() => {
  // Make action-click open the side panel when supported.
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    // Ignore on older Chrome versions.
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg.type !== "string") return sendResponse({ ok: false, error: "Invalid message" });

    if (msg.type === "COURSE_IMPORT") {
      const course = msg.course;
      if (!course || course.id !== "top-interview-150") {
        return sendResponse({ ok: false, error: "Unsupported course payload" });
      }
      // Ensure baseline derived fields exist even if the sender didn't compute them.
      if (!course.total) course.total = uniqueSlugsFromCourse(course).length;
      if (!course.lcStats || typeof course.lcStats !== "object") course.lcStats = computeCourseLcStats(course);

      const site = course.site ? String(course.site).trim() : "";
      if (site) {
        await storageSet({ [`course:top-interview-150:${site}`]: course });
      }
      // Keep last-imported as default.
      await storageSet({ "course:top-interview-150": course });

      await upgradeLocalProgressFromCourse(course);

      // Leetcode.cn may block extension-context fetch to /api/problems/all/ (Cloudflare). If so, run the fetch in the
      // page main-world and patch the course + local progress from the returned status map.
      const tabId = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
      if (tabId && shouldBackfillLcStatus(course)) {
        const fetched = await fetchAllProblemsApiFromTab(tabId);
        if (fetched.ok && fetched.json) {
          const statusMap = buildSlugStatusMapFromAllProblemsApi(fetched.json);
          applyLcStatusMapToCourse(course, statusMap, "api/problems/all");
          if (site) await storageSet({ [`course:top-interview-150:${site}`]: course });
          await storageSet({ "course:top-interview-150": course });
          await upgradeLocalProgressFromCourse(course);
        }
      }

      return sendResponse({ ok: true });
    }

    if (msg.type === "GET_COURSE") {
      const site = msg.site ? String(msg.site).trim() : "";
      const keys = ["course:top-interview-150"];
      if (site) keys.unshift(`course:top-interview-150:${site}`);
      const obj = await storageGet(keys);
      const course = site ? obj[`course:top-interview-150:${site}`] || obj["course:top-interview-150"] : obj["course:top-interview-150"];
      return sendResponse({ ok: true, course: course || null });
    }

    if (msg.type === "GET_PROGRESS") {
      const slug = String(msg.slug || "").trim();
      if (!slug) return sendResponse({ ok: false, error: "Missing slug" });
      const progress = await readProgress(slug);
      return sendResponse({ ok: true, progress });
    }

    if (msg.type === "PATCH_PROGRESS") {
      const slug = String(msg.slug || "").trim();
      if (!slug) return sendResponse({ ok: false, error: "Missing slug" });
      const before = await readProgress(slug);
      const progress = await patchProgress(slug, msg.patch || {});
      const site = msg.site ? String(msg.site).trim() : "";
      if (normalizeBool((await getSettings()).memoryEnabled, true)) {
        const prev = normalizeStatus(before.status);
        const next = normalizeStatus(progress.status);
        if (prev !== next) {
          if (next === "in_progress" && prev === "unstarted") await bumpTopicStat({ site, slug, stage: "progress", deltaKey: "started" });
          if (next === "solved" && (prev === "unstarted" || prev === "in_progress")) await bumpTopicStat({ site, slug, stage: "progress", deltaKey: "solved" });
          if (next === "reviewed") await bumpTopicStat({ site, slug, stage: "progress", deltaKey: "reviewed" });
        }
      }
      return sendResponse({ ok: true, progress });
    }

    if (msg.type === "ATTEMPT_GET") {
      const slug = String(msg.slug || "").trim();
      if (!slug) return sendResponse({ ok: false, error: "Missing slug" });
      const attempt = await readAttempt(slug);
      return sendResponse({ ok: true, attempt });
    }

    if (msg.type === "ATTEMPT_SET") {
      const slug = String(msg.slug || "").trim();
      if (!slug) return sendResponse({ ok: false, error: "Missing slug" });
      const attempt = await patchAttempt(slug, msg.patch || {});
      return sendResponse({ ok: true, attempt });
    }

    if (msg.type === "GET_CHAT") {
      const slug = String(msg.slug || "").trim();
      if (!slug) return sendResponse({ ok: false, error: "Missing slug" });
      const chat = await readChat(slug);
      return sendResponse({ ok: true, chat });
    }

    if (msg.type === "CLEAR_CHAT") {
      const slug = String(msg.slug || "").trim();
      if (!slug) return sendResponse({ ok: false, error: "Missing slug" });
      const key = await getChatKey(slug);
      await storageRemove([key]);
      return sendResponse({ ok: true });
    }

    if (msg.type === "SETTINGS_GET") {
      const settings = await getSettings();
      return sendResponse({ ok: true, settings });
    }

    if (msg.type === "SETTINGS_SET") {
      await storageSet({ settings: msg.settings || {} });
      const settings = await getSettings();
      return sendResponse({ ok: true, settings });
    }

    if (msg.type === "MEMORY_GET") {
      const mem = await readUserMemory();
      return sendResponse({ ok: true, memory: mem });
    }

    if (msg.type === "MEMORY_CLEAR") {
      const n = await clearAllMemory();
      return sendResponse({ ok: true, removed: n });
    }

    if (msg.type === "LLM_CHAT") {
      const slugRaw = String(msg.slug || "").trim();
      const slug = slugRaw || "global";
      const stage = normalizeStage(msg.stage);
      const userText = String(msg.userMessage || "").trim();
      if (!userText) return sendResponse({ ok: false, error: "Empty message" });

      const settings = await getSettings();
      if (!settings.baseUrl) return sendResponse({ ok: false, error: "Missing baseUrl in settings" });

      const history = compactHistory(await readChat(slug), 16);
      const site = msg.site ? String(msg.site).trim() : "";
      const mem = await readUserMemory();
      const topic = slugRaw && slugRaw !== "global" ? await topicForSlug(slugRaw, site) : "";

      let sys = buildSystemPrompt(stage, settings);
      if (normalizeBool(settings.memoryEnabled, true)) {
        const lang = normalizeOutputLanguage(settings?.outputLanguage);
        const topStrengths = (Array.isArray(mem.strengths) ? mem.strengths : []).slice(0, 4).map((x) => x.text).filter(Boolean);
        const topWeaknesses = (Array.isArray(mem.weaknesses) ? mem.weaknesses : []).slice(0, 4).map((x) => x.text).filter(Boolean);
        const topBottlenecks = (Array.isArray(mem.bottlenecks) ? mem.bottlenecks : []).slice(0, 4).map((x) => x.text).filter(Boolean);
        const summary = String(mem.summary || "").trim().slice(0, 800);
        const lines = [];
        if (summary) lines.push(`User memory summary: ${summary}`);
        if (topStrengths.length) lines.push(`Known strengths: ${topStrengths.join("; ")}`);
        if (topWeaknesses.length) lines.push(`Known weaknesses: ${topWeaknesses.join("; ")}`);
        if (topBottlenecks.length) lines.push(`Known bottlenecks: ${topBottlenecks.join("; ")}`);

        const topicStats = mem && mem.topics && typeof mem.topics === "object" ? mem.topics : {};
        const topicEntries = [];
        for (const [k, v] of Object.entries(topicStats)) {
          if (!k) continue;
          const st = v && typeof v === "object" ? v : {};
          const interactions = Number.isFinite(Number(st.interactions)) ? Number(st.interactions) : 0;
          const hintRequests = Number.isFinite(Number(st.hintRequests)) ? Number(st.hintRequests) : 0;
          const solved = Number.isFinite(Number(st.solved)) ? Number(st.solved) : 0;
          const reviewed = Number.isFinite(Number(st.reviewed)) ? Number(st.reviewed) : 0;
          if (interactions + hintRequests + solved + reviewed <= 0) continue;
          const hintRate = hintRequests / Math.max(1, interactions);
          const score = hintRate + 0.08 * Math.min(1, interactions / 12);
          topicEntries.push({ topic: k, interactions, hintRequests, solved, reviewed, score });
        }
        topicEntries.sort((a, b) => b.score - a.score);
        const topTopics = topicEntries.slice(0, 3);
        if (topTopics.length) {
          if (lang === "en") {
            lines.push(
              `Topic stats (recent): ${topTopics
                .map((t) => `${t.topic} (hints ${t.hintRequests}/${t.interactions}, solved ${t.solved}, reviewed ${t.reviewed})`)
                .join(" | ")}`
            );
          } else {
            lines.push(
              `题型统计（近期）：${topTopics
                .map((t) => `${t.topic}（提示 ${t.hintRequests}/${t.interactions}，已通过 ${t.solved}，已复习 ${t.reviewed}）`)
                .join(" | ")}`
            );
          }
        }

        if (lines.length) sys = `${sys}\n\n${lines.join("\n")}`;
      }

      const isSpoilerStage = stage === "hint" || stage === "pseudocode" || stage === "explain";
      if (
        settings.spoilerGuard &&
        isSpoilerStage &&
        slugRaw &&
        slugRaw !== "global" &&
        !((msg.code && typeof msg.code === "string" && msg.code.trim()) || false)
      ) {
        const attempt = await readAttempt(slug);
        const notesLen = String(attempt.notes || "").trim().length;
        const minChars = Number.isFinite(Number(settings.minAttemptChars)) ? Number(settings.minAttemptChars) : 40;
        const unlocked = Boolean(attempt.tried) || notesLen >= minChars;
        if (!unlocked) {
          const assistantContent = spoilerGuardBlockMessage(settings);
          const nextChat = await appendChat(slug, [
            { role: "user", content: userText },
            { role: "assistant", content: assistantContent }
          ]);
          await patchProgress(slug, { status: "in_progress", lastStage: stage });
          return sendResponse({ ok: true, assistant: assistantContent, chat: nextChat, blocked: true });
        }
      }

      const problem = msg.problem || {};
      const parts = [];
      if (topic) parts.push(`Course Topic:\n- ${topic}`);
      if (problem && (problem.slug || problem.title || problem.difficulty || problem.contentText)) {
        parts.push(
          [
            "Problem Context:",
            problem.title ? `- title: ${problem.title}` : null,
            problem.slug ? `- slug: ${problem.slug}` : null,
            problem.difficulty ? `- difficulty: ${problem.difficulty}` : null,
            Array.isArray(problem.tags) && problem.tags.length ? `- tags: ${problem.tags.join(", ")}` : null,
            problem.contentText ? `\nStatement:\n${problem.contentText}` : null
          ]
            .filter(Boolean)
            .join("\n")
        );
      }

      if (slugRaw && slugRaw !== "global") {
        const attempt = await readAttempt(slugRaw);
        const notes = String(attempt && attempt.notes ? attempt.notes : "").trim();
        if (notes) parts.push(`User Attempt Notes:\n${notes}`);
      }

      if (msg.code && typeof msg.code === "string" && msg.code.trim()) {
        const lang = String(msg.language || "").trim() || "unknown";
        parts.push(`User Code (${lang}):\n${msg.code}`);
      }

      parts.push(`User Request:\n${userText}`);
      const userPrompt = parts.join("\n\n");

      const messages = [{ role: "system", content: sys }, ...history, { role: "user", content: userPrompt }];

      let assistantContent;
      try {
        const out = await callChatCompletions({
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          messages
        });
        assistantContent = out.content;
      } catch (e) {
        return sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }

      const nextChat = await appendChat(slug, [
        { role: "user", content: userText },
        { role: "assistant", content: assistantContent }
      ]);

      if (slugRaw && slugRaw !== "global") {
        await patchProgress(slug, { status: "in_progress", lastStage: stage });
      }

      if (normalizeBool(settings.memoryEnabled, true) && slugRaw && slugRaw !== "global") {
        await bumpTopicStat({ site, slug: slugRaw, stage, deltaKey: "interactions" });
        if (["hint", "pseudocode", "explain"].includes(stage)) await bumpTopicStat({ site, slug: slugRaw, stage, deltaKey: "hintRequests" });
        if (stage === "review") await bumpTopicStat({ site, slug: slugRaw, stage, deltaKey: "reviews" });

        if (normalizeBool(settings.memoryAutoCurate, true) && (stage === "review" || stage === "postmortem")) {
          try {
            const curated = await curateMemoryWithLLM({
              settings,
              mem,
              context: {
                site,
                slug: slugRaw,
                topic,
                stage,
                user: userText.slice(0, 1200),
                assistant: assistantContent.slice(0, 1200)
              }
            });
            if (curated && typeof curated === "object") {
              const now = nowIso();
              const nextMem = await readUserMemory();
              const summary = typeof curated.summary === "string" ? curated.summary.trim().slice(0, 800) : nextMem.summary || "";
              const strengths = upsertMemoryList(nextMem.strengths, curated.strengths, now, 10);
              const weaknesses = upsertMemoryList(nextMem.weaknesses, curated.weaknesses, now, 10);
              const bottlenecks = upsertMemoryList(nextMem.bottlenecks, curated.bottlenecks, now, 10);
              const mastered = upsertMemoryList(nextMem.mastered, curated.mastered, now, 10);
              await writeUserMemory({ ...nextMem, summary, strengths, weaknesses, bottlenecks, mastered });
            }
          } catch (e) {
            // Ignore memory failures; do not block the user.
          }
        }
      }

      return sendResponse({ ok: true, assistant: assistantContent, chat: nextChat });
    }

    return sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  })();

  // Keep the message channel open for async responses.
  return true;
});
