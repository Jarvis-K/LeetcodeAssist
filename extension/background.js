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
      const site = course.site ? String(course.site).trim() : "";
      if (site) {
        await storageSet({ [`course:top-interview-150:${site}`]: course });
      }
      // Keep last-imported as default.
      await storageSet({ "course:top-interview-150": course });

      // Import completion state into local progress if user hasn't tracked it yet.
      // Rule: never downgrade an existing state; only upgrade unstarted/in_progress based on LeetCode state.
      const items = [];
      for (const section of course.sections || []) {
        for (const it of section.items || []) items.push(it);
      }
      const slugs = items
        .map((it) => (it && it.slug ? String(it.slug).trim() : ""))
        .filter(Boolean);
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
      const progress = await patchProgress(slug, msg.patch || {});
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

    if (msg.type === "LLM_CHAT") {
      const slugRaw = String(msg.slug || "").trim();
      const slug = slugRaw || "global";
      const stage = normalizeStage(msg.stage);
      const userText = String(msg.userMessage || "").trim();
      if (!userText) return sendResponse({ ok: false, error: "Empty message" });

      const settings = await getSettings();
      if (!settings.baseUrl) return sendResponse({ ok: false, error: "Missing baseUrl in settings" });

      const history = compactHistory(await readChat(slug), 16);
      const sys = buildSystemPrompt(stage, settings);

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

      return sendResponse({ ok: true, assistant: assistantContent, chat: nextChat });
    }

    return sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  })();

  // Keep the message channel open for async responses.
  return true;
});
