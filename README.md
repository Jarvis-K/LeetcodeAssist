# leetcoder

Agent-driven LeetCode assistant (Chrome extension) focused on the LeetCode "Top Interview 150" (Hot150) study plan.

## Run (Load Unpacked)

1. Open Chrome -> `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select:
   - `/Users/jarvis/Desktop/myRepos/leetcoder/extension`
4. Open LeetCode:
   - Study plan page (recommended once to import the curriculum): `https://leetcode.com/studyplan/top-interview-150/`
   - Or CN site: `https://leetcode.cn/studyplan/top-interview-150/`
   - Any problem page: `https://leetcode.com/problems/<slug>/`
   - Or CN site: `https://leetcode.cn/problems/<slug>/`
5. Open the extension side panel:
   - Click the extension icon -> "Open Side Panel"

## What You Get (MVP)

- Course view: Imports Top Interview 150 sections/problems from the study plan page and caches it locally.
- Tutor view: Stage-driven agent chat (plan/hints/explain/review) with per-problem memory.
- Review view: Paste code for correctness/complexity/edge-case review.
- Settings: Configure an OpenAI-compatible API endpoint + key + model.
- Bilingual: UI language + tutor output language (中文 / English).
- Spoiler Guard: Unlock hints/pseudocode/explain only after you record your own attempt.

## Notes

- The extension is built without a bundler (plain HTML/CSS/JS) to keep iteration simple.
- If course import fails, open the Top Interview 150 page once and refresh; the extension scrapes `__NEXT_DATA__` and stores the curriculum.
