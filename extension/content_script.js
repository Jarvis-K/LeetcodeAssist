/* global chrome */

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function getNextData() {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el || !el.textContent) return null;
  return safeJsonParse(el.textContent);
}

function walk(root, visitor) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || (typeof node !== "object" && typeof node !== "function")) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    visitor(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push(node[i]);
    } else {
      for (const k of Object.keys(node)) stack.push(node[k]);
    }
  }
}

function normalizeDifficulty(d) {
  if (!d) return "";
  if (typeof d === "string") return d;
  // Sometimes difficulty comes as 1/2/3.
  if (d === 1) return "Easy";
  if (d === 2) return "Medium";
  if (d === 3) return "Hard";
  return String(d);
}

function normalizeQuestion(q) {
  if (!q || typeof q !== "object") return null;
  const base = q.question && typeof q.question === "object" ? q.question : q;

  function detectLcState(obj) {
    if (!obj || typeof obj !== "object") return "";

    const boolTrueSolved = ["isSolved", "is_solved", "solved", "completed", "isCompleted", "done", "finished"];
    for (const k of boolTrueSolved) {
      if (obj[k] === true) return "solved";
    }

    const boolTrueStarted = ["isStarted", "started", "attempted", "tried"];
    for (const k of boolTrueStarted) {
      if (obj[k] === true) return "in_progress";
    }

    const statusStr =
      obj.lcState ||
      obj.lcStatus ||
      obj.completionStatus ||
      obj.userStatus ||
      obj.questionStatus ||
      obj.status ||
      obj.state ||
      "";
    if (typeof statusStr === "number" && Number.isFinite(statusStr)) {
      // Common enum-like patterns: 0=todo, 1=started, 2=done.
      if (statusStr >= 2) return "solved";
      if (statusStr >= 1) return "in_progress";
      return "unstarted";
    }
    if (statusStr && typeof statusStr === "object") {
      const inner = statusStr.status || statusStr.state || statusStr.value || statusStr.name || "";
      if (typeof inner === "string" && inner.trim()) {
        const s = inner.toLowerCase().trim();
        if (s.includes("notac") || s.includes("wrong") || s.includes("wa")) return "in_progress";
        if (s === "ac" || s.includes("accepted") || s.includes("solved") || s.includes("done") || s.includes("complete")) {
          return "solved";
        }
        if (s.includes("attempt") || s.includes("tried") || s.includes("progress")) {
          return "in_progress";
        }
        if (s.includes("todo") || s.includes("unstarted") || s.includes("not started")) return "unstarted";
      }
    }
    if (typeof statusStr === "string" && statusStr.trim()) {
      const s = statusStr.toLowerCase().trim();
      if (s.includes("notac") || s.includes("wrong") || s.includes("wa")) return "in_progress";
      if (s === "ac" || s.includes("accepted") || s.includes("solved") || s.includes("done") || s.includes("complete")) {
        return "solved";
      }
      if (s.includes("attempt") || s.includes("tried") || s.includes("progress")) {
        return "in_progress";
      }
      if (s.includes("todo") || s.includes("unstarted") || s.includes("not started")) return "unstarted";
    }

    const progress = obj.progress ?? obj.completion ?? obj.completeRate;
    if (typeof progress === "number" && Number.isFinite(progress)) {
      // Some payloads use 0..1, others 0..100.
      if (progress >= 1 && progress <= 1.000001) return "solved";
      if (progress >= 100) return "solved";
      if (progress > 0) return "in_progress";
    }

    return "";
  }

  const slug =
    base.titleSlug ||
    base.questionTitleSlug ||
    base.questionSlug ||
    base.slug ||
    base.title_slug ||
    base.question_title_slug ||
    q.titleSlug ||
    q.questionTitleSlug ||
    q.questionSlug ||
    q.slug ||
    q.title_slug ||
    q.question_title_slug;

  const title =
    base.translatedTitle ||
    base.titleCn ||
    base.title_cn ||
    base.questionTitle ||
    base.title ||
    q.translatedTitle ||
    q.titleCn ||
    q.title_cn ||
    q.questionTitle ||
    q.title ||
    q.question_title;

  if (typeof slug !== "string" || !slug.trim()) return null;
  if (typeof title !== "string" || !title.trim()) return null;

  const lcState = detectLcState(q) || detectLcState(base);

  return {
    slug: slug.trim(),
    title: title.trim(),
    difficulty: normalizeDifficulty(base.difficulty || base.difficultyLevel || base.level || q.difficulty || q.difficultyLevel || q.level),
    paidOnly: Boolean(base.paidOnly || base.isPaidOnly || q.paidOnly || q.isPaidOnly),
    lcState
  };
}

function extractStudyPlanFromNextData(nextData) {
  // Try the most likely Next.js + ReactQuery payload first.
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (Array.isArray(queries)) {
    for (const q of queries) {
      const data = q?.state?.data;
      const plan =
        data?.studyPlanV2Detail || data?.studyPlanDetail || data?.studyPlan || data?.studyPlanV2 || null;
      if (!plan || typeof plan !== "object") continue;

      const sectionsRaw =
        plan.planSubsections || plan.subsections || plan.sections || plan.chapters || plan.subPlans || null;
      if (!Array.isArray(sectionsRaw)) continue;

      const sections = [];
      for (const s of sectionsRaw) {
        const title = s?.title || s?.name || s?.chapterTitle || s?.subsectionTitle;
        const itemsRaw =
          s?.questions || s?.questionList || s?.problems || s?.items || s?.questionListV2 || s?.questionsV2;
        if (typeof title !== "string" || !Array.isArray(itemsRaw)) continue;
        const items = itemsRaw.map(normalizeQuestion).filter(Boolean);
        if (items.length) sections.push({ title: title.trim(), items });
      }

      if (sections.length) {
        const title = plan.title || plan.name || "Top Interview 150";
        return { title, sections };
      }
    }
  }

  // Heuristic fallback: scan for objects that look like { title, questions: [...] }.
  const candidates = [];
  walk(nextData, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const title = node.title || node.name;
    if (typeof title !== "string" || title.trim().length < 2) return;

    const arrayProps = [];
    for (const k of Object.keys(node)) {
      if (Array.isArray(node[k])) arrayProps.push(k);
    }
    for (const k of arrayProps) {
      const arr = node[k];
      if (!Array.isArray(arr) || arr.length < 3) continue;
      const items = arr.map(normalizeQuestion).filter(Boolean);
      if (items.length >= 3) candidates.push({ title: title.trim(), items });
    }
  });

  // Pick a candidate set that looks like a study plan: multiple sections, lots of unique problems.
  if (candidates.length) {
    // Deduplicate candidates by (title + firstSlug).
    const dedup = new Map();
    for (const c of candidates) {
      const key = `${c.title}::${c.items[0]?.slug || ""}`;
      if (!dedup.has(key) || dedup.get(key).items.length < c.items.length) dedup.set(key, c);
    }
    const sections = Array.from(dedup.values()).sort((a, b) => b.items.length - a.items.length);

    // If there are many sections, take the top ones whose total unique slugs gets close to 150.
    const picked = [];
    const seenSlugs = new Set();
    for (const s of sections) {
      const fresh = s.items.filter((it) => !seenSlugs.has(it.slug));
      if (fresh.length < 3) continue;
      picked.push({ title: s.title, items: fresh });
      fresh.forEach((it) => seenSlugs.add(it.slug));
      if (seenSlugs.size >= 140 && picked.length >= 10) break;
    }
    if (picked.length && seenSlugs.size >= 80) {
      return { title: "Top Interview 150", sections: picked };
    }
  }

  return null;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { method: "GET", credentials: "include" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchAllProblemsApi() {
  // For logged-in users, this includes per-problem status ("ac"/"notac"/null).
  const candidates = ["/api/problems/all/", "/api/problems/algorithms/"];
  for (const path of candidates) {
    const json = await fetchJson(path);
    if (json && Array.isArray(json.stat_status_pairs)) return json;
  }
  return null;
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

function getProblemSlugFromPathname(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const i = parts.indexOf("problems");
  if (i >= 0 && parts[i + 1]) return parts[i + 1];
  return "";
}

function htmlToText(html) {
  if (typeof html !== "string" || !html.trim()) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  const text = (div.innerText || div.textContent || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const trimmed = text.trim();
  // Keep prompts bounded; the agent can ask for more if needed.
  return trimmed.slice(0, 9000);
}

function extractProblemFromNextData(nextData, slug) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (Array.isArray(queries)) {
    for (const q of queries) {
      const data = q?.state?.data;
      const question = data?.question;
      if (question && typeof question === "object") {
        if (question.titleSlug === slug || !slug) {
          const tags = Array.isArray(question.topicTags)
            ? question.topicTags.map((t) => t?.name).filter(Boolean)
            : [];

          const title = question.translatedTitle || question.title || "";
          const contentHtml = question.translatedContent || question.content || "";
          return {
            slug: question.titleSlug || slug,
            title,
            difficulty: normalizeDifficulty(question.difficulty),
            contentHtml,
            contentText: htmlToText(contentHtml),
            tags
          };
        }
      }
    }
  }

  // Fallback: scan for an object that looks like the question payload.
  let best = null;
  walk(nextData, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (typeof node.titleSlug === "string" && typeof node.content === "string") {
      if (slug && node.titleSlug !== slug) return;
      const contentText = htmlToText(node.content);
      if (!contentText || contentText.length < 200) return;
      const tags = Array.isArray(node.topicTags) ? node.topicTags.map((t) => t?.name).filter(Boolean) : [];
      best = {
        slug: node.titleSlug,
        title: node.title || "",
        difficulty: normalizeDifficulty(node.difficulty),
        contentHtml: node.content,
        contentText,
        tags
      };
    }
  });

  return best;
}

let lastCourseImportAtMs = 0;

async function maybeImportCourse() {
  await importCourse({ force: false });
}

async function importCourse({ force }) {
  if (!String(location.pathname || "").includes("/studyplan/top-interview-150")) return { ok: false, error: "Not on study plan page" };
  const now = Date.now();
  if (!force && now - lastCourseImportAtMs < 5000) return { ok: true, skipped: true };
  lastCourseImportAtMs = now;

  const nextData = getNextData();
  if (!nextData) return { ok: false, error: "Missing __NEXT_DATA__" };
  const plan = extractStudyPlanFromNextData(nextData);
  if (!plan || !Array.isArray(plan.sections) || !plan.sections.length) return { ok: false, error: "Failed to extract plan from __NEXT_DATA__" };

  const seen = new Set();
  const sections = plan.sections.map((s) => {
    const items = (s.items || []).filter((it) => it && it.slug && !seen.has(it.slug));
    items.forEach((it) => seen.add(it.slug));
    return { title: s.title, items };
  });

  const course = {
    id: "top-interview-150",
    title: String(plan.title || "Top Interview 150"),
    importedAt: new Date().toISOString(),
    site: location.origin,
    total: seen.size,
    sections
  };

  // Prefer authoritative per-user status from the problems API if available.
  const allApi = await fetchAllProblemsApi();
  if (allApi) {
    const statusMap = buildSlugStatusMapFromAllProblemsApi(allApi);
    for (const sec of course.sections) {
      for (const it of sec.items || []) {
        const slug = it && it.slug ? String(it.slug).trim() : "";
        if (!slug) continue;
        const st = statusMap.get(slug);
        if (st) it.lcState = st;
      }
    }
    course.statusSource = "api/problems/all";
  } else {
    course.statusSource = "next_data";
  }

  const lcStats = { solved: 0, in_progress: 0, unstarted: 0, unknown: 0 };
  for (const section of course.sections) {
    for (const it of section.items || []) {
      const s = String(it.lcState || "").toLowerCase().trim();
      if (s === "solved") lcStats.solved += 1;
      else if (s === "in_progress") lcStats.in_progress += 1;
      else if (s === "unstarted") lcStats.unstarted += 1;
      else lcStats.unknown += 1;
    }
  }
  course.lcStats = lcStats;

  chrome.runtime.sendMessage({ type: "COURSE_IMPORT", course }, () => {
    // Ignore errors; the side panel can show import status by reading storage later.
  });
  return { ok: true, course: { site: course.site, total: course.total, lcStats: course.lcStats, statusSource: course.statusSource } };
}

function getCurrentProblemContext() {
  const slug = getProblemSlugFromPathname(location.pathname);
  if (!slug) return null;
  const nextData = getNextData();
  if (!nextData) return { slug };
  const problem = extractProblemFromNextData(nextData, slug);
  return problem || { slug };
}

function mapMonacoLangToLeetCode(langId) {
  const v = String(langId || "").toLowerCase();
  if (!v) return "";
  if (v.includes("python")) return "python";
  if (v.includes("java")) return "java";
  if (v.includes("cpp") || v.includes("c++")) return "cpp";
  if (v.includes("typescript")) return "typescript";
  if (v.includes("javascript")) return "javascript";
  if (v === "go" || v.includes("golang")) return "go";
  return v;
}

function getEditorCode() {
  // Monaco editor (most common on LeetCode).
  try {
    const monaco = window.monaco;
    if (monaco && monaco.editor && typeof monaco.editor.getModels === "function") {
      const models = monaco.editor.getModels() || [];
      let best = null;
      let bestScore = -1;
      for (const m of models) {
        if (!m || typeof m.getValue !== "function") continue;
        const value = String(m.getValue() || "");
        const len = value.trim().length;
        if (len < 10) continue;
        const lineCount = typeof m.getLineCount === "function" ? Number(m.getLineCount() || 0) : value.split("\n").length;
        const score = len + Math.min(2000, lineCount * 20);
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
      if (best) {
        const value = String(best.getValue() || "");
        const langId = typeof best.getLanguageId === "function" ? best.getLanguageId() : "";
        return { code: value, language: mapMonacoLangToLeetCode(langId) };
      }
    }
  } catch (e) {
    // ignore
  }

  // Fallback: try any visible textarea (rare, but better than nothing).
  try {
    const ta = document.querySelector("textarea");
    if (ta && typeof ta.value === "string" && ta.value.trim().length > 10) return { code: ta.value, language: "" };
  } catch (e) {
    // ignore
  }

  return { code: "", language: "" };
}

let lastHref = location.href;
function onUrlChange() {
  if (location.href === lastHref) return;
  lastHref = location.href;
  // Import course opportunistically when user visits the study plan page.
  maybeImportCourse();
}

function hookHistory() {
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  history.pushState = function () {
    // eslint-disable-next-line prefer-rest-params
    pushState.apply(this, arguments);
    window.dispatchEvent(new Event("leetcode-agent:urlchange"));
  };
  history.replaceState = function () {
    // eslint-disable-next-line prefer-rest-params
    replaceState.apply(this, arguments);
    window.dispatchEvent(new Event("leetcode-agent:urlchange"));
  };
  window.addEventListener("popstate", () => window.dispatchEvent(new Event("leetcode-agent:urlchange")));
  window.addEventListener("leetcode-agent:urlchange", () => onUrlChange());
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg.type !== "string") return sendResponse({ ok: false, error: "Invalid message" });
    if (msg.type === "CS_GET_PROBLEM_CONTEXT") {
      const problem = getCurrentProblemContext();
      return sendResponse({ ok: true, problem });
    }
    if (msg.type === "CS_GET_EDITOR_CODE") {
      const out = getEditorCode();
      if (out && out.code && String(out.code).trim()) {
        return sendResponse({ ok: true, code: out.code, language: out.language || "" });
      }
      return sendResponse({ ok: false, error: "Editor code not found. Open a problem and focus the editor first." });
    }
    if (msg.type === "CS_FORCE_COURSE_IMPORT") {
      const out = await importCourse({ force: true });
      return sendResponse(out);
    }
    return sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  })();
  return true;
});

hookHistory();
maybeImportCourse();
