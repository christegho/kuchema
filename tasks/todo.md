# Slow providers halting collage creation

Root cause: a 180 s deadline covered the body of non-streaming OpenRouter calls, which commit HTTP 200 before the provider finishes, so slow but healthy responses were cut off and reported as "unreadable".

- [x] `server/ai.js`: 300 s deadline covering fetch + body; classify timeouts as retryable `TIMEOUT`
- [x] `server/pipeline.js`: keep the draft arrangement when every provider fails the layout review
- [x] `tests/routing.test.js`: mid-body timeout, deadline value, undici header/body timeouts, mid-body socket drop
- [x] `tests/pipeline.test.js`: critique outage completes with the draft; credit errors still stop
- [x] `README.md`: document the deadline and review fallback
- [x] Full test suite passes

## Review

- Evidence: job `f8b8593a` failed 180.6 s after sending the plan to Parasail; a successful plan took ~158 s and a successful critique ~179.5 s.
- `npm test`: 91/91 pass (88 existing + 3 new). Against the original server code the new critique test fails and the routing suite fails to load.
- Not done, by decision: reserved same-provider retries in `pricingPlan`, aborting in-flight requests on Stop, streaming with stall detection.
- Follow-up: the running servers (pids 44640 and 45787, a stray that never bound a port) predate this change and must be restarted.

# Speculative research-led images, visible treatments, faster studies

Plan: ~/.claude/plans/fancy-hugging-mochi.md

- [x] C. `server/transforms.js`: recalibrated visible treatments, `treatedImage`/`treatedCut`, budget 3 types on every generated fragment
- [x] C. Contact sheet: old vs new treatments on real generated images
- [x] A. `server/research.js`: 3 leadable texts + 3 papers, one text per led slot, paper layout consequences, audit N
- [x] A. `server/plan.js` + `server/archive.js`: research count 6–10, papers object, treated generated slots, people ≤ count−3
- [x] B/C/D. `server/pipeline.js`: speculative prompts, parallel generation (2), segment → treat → crop, retry with palette, preflight concurrency
- [x] D. `scripts/vision-worker.py` + `server/vision.js`: one SAM encoding per photo; MPS benchmark (background agent)
- [x] B. Rule text: `server/context.js`, `training-data/system_prompt.txt` §1/§7, `training-data/image_prompt.txt`
- [x] UI: research select 6–10, paper consequences, text-led parts
- [x] Docs: README, architecture.md
- [x] Tests updated + new; `npm test`, `npm run build`

## Review

- Treatments: contact sheets (old vs new at 0.6/0.9 on two real 2K generations) show every treatment visible; before, six of eleven changed a textured pattern by < 2/255, now all ≥ 3.8. Tonal steps keep hues (no neon); grain scales with image size.
- Segment → treat → crop: SAM cuts the untreated image; the whole image is treated, then cropped with SAM's box and alpha. Tested byte-for-byte (alpha identical, RGB equals treated full image).
- Research: 6–10 files, ≥3 speculative texts each lead one generated image, ≥3 papers each state a layout consequence; people capped at count−3.
- Speed: image generation 2 at a time; SAM group prompts batched (group cut 6.7 s → 2.0 s, masks IoU 1.0); worker loads alongside the price check. MPS measured 1.2–1.5× end to end, so VISION_DEVICE stays cpu (`auto` now supported).
- Machine: 14.7 of 16 GB swap in use during review; the erratic 50–80 s local gaps in study a5e75b50 are memory pressure, not code.
- `npm test` 94/94, `npm run build` ok, browser UI suite passes. No paid run yet.

# Incomplete plans ("The planning model returned an incomplete plan")

Root cause: study 86473e04's plan stopped mid-JSON at slot F09 (18,891 chars) — the planner's 5,000-token output limit for ≤10 images. A 12-image plan needs ~6,200 tokens.

- [x] `server/budget.js`: planner limit 2,000 + 900 × images, capped at 16,000 (all planner endpoints accept 16,384); live plans still ≤ $1.00
- [x] `server/routing.js`: cut-off (`finish_reason: length`) or unparseable JSON answers fail over as `TRUNCATED` / `MALFORMED_JSON`; paid call stays settled
- [x] `server/ai.js`: accurate messages; both codes retryable (also covers the layout-review fallback)
- [x] Tests (fails on old routing, passes now); README; `npm test` 94/94

## Review
- The same study also shows the backend was never restarted: job `version: 8` and DeepInfra cut off at exactly 180 s. None of today's backend changes are live until the server restarts.

# Three-part prompts, colleague feedback, several cuts per image, torn edges

Plan: ~/.claude/plans/fancy-hugging-mochi.md

- [x] 1. Prompts: system (A–E, people B kept), user (short text, people ¶ kept), technical prompt file; context.js + pipeline assembly; UI read-only rules
- [x] 2. Research: 3–6 passages, ≥2 led, relationships; references 2+2 (3+3 >12); open-access safeguard
- [x] 3. Torn-paper edges module + tests + edge sheet (background agent)
- [x] 4. Several cuts per image: details slots, tiers, grounding/cutting/coverage/critique/retry
- [x] 5. Docs clean-up; npm test, build, browser; server check then stop

## Review
- Prompts: system = colleague A–E (section B kept as archive-cutouts-only people); user = colleague short text (people paragraph kept); technical = training-data/technical_prompt.txt (8.5k chars, binding, read-only in UI, sent first in every call, snapshotted per job). ARCHIVE_IMAGE_RULES, CURRENT WORKFLOW CONSTRAINTS and contextRules removed from code; technical_details.md no longer sent to the planner.
- Research 3–6 passages (default 4), ≥2 lead images, relationships for every passage; references 2+2 (3+3 above 12 images); open-access folder imported but never referenced until licences exist.
- Several cuts per image: fixed detail slots (12–21 fragments), tiers with soft warning, per-fragment grounding/cuts/coverage/retries, review omissions restored. Torn-paper edges on generated fragments (people always clean).
- npm test 105/105 (9.4 min under load avg ~26 and 17 GB swap), build ok, browser suite passes. New code verified booting on port 3101 with temp data, then stopped. User's own server (pid 31678, 17 Oct) still runs the old code on :3000.
