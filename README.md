# Code Review Platform (JEV)

An AI code review tool built on the JEV decision API. Developers paste code, upload a source file, or submit a unified Git diff. The server asks JEV a set of structured questions about each region of code, then turns the answers into located findings in a split-pane UI.

- API base URL: `https://jev-ai.pro/api` (pinned in code; any other value is rejected)
- Decision endpoint: `POST /v1/systemone`
- Model discovery: `GET /v1/models`
- Model: `jev-latest` (answered in testing by `typesafe-ai/jev-1.14.0`)
- Docs: https://jev-ai.pro/docs (sections `#official-sdk`, `#errors`)
- API keys: https://jev-ai.pro/jev-api

Nothing in this project claims anything about JEV's accuracy, architecture, or superiority over other models. Review quality on real code has not been measured.

---

## 1. Status

| Phase | Scope | State |
|---|---|---|
| 1 | JEV integration: config, client, errors, schemas, verification scripts | Done. Verified against the real API: one model-list call and one decision call |
| 2 | Next.js app, paste/upload/diff input, diff parser, review engine, findings UI | Done for direct review. Results screen not yet checked in a browser with live data |
| 2b | Claude analysis layer (JEV-only / standard / thorough), cost controls, shared-token access control, duplicate-submission protection | Implemented and unit-tested with mocked providers. Not exercised against the live Anthropic API or in a browser with live data. See section 14 |
| 3 | Authentication (per-user), database, persistent review history, saved resolve/ignore | Not started |
| 4 | GitHub App connection, repo and PR listing, read-only PR review | Not started |
| 5 | Publishing inline PR comments with approval, idempotency, stale revisions | Not started |
| 6 | Production hardening, deployment docs | Partial: 63 tests (mocked), typecheck and production build pass |

Not implemented anywhere yet: per-user authentication (only a shared access token exists, section 14), database/Prisma, history and dashboard pages, GitHub integration, webhooks, job queue, theme toggle (the UI follows the OS light/dark setting), shadcn/ui, accessibility audit, linting.

---

## 2. Quick start

Requirements: Node.js 20+ (developed on Node 24), npm.

```bash
npm install
cp .env.example .env.local     # then add your key to .env.local
npm run jev:verify             # no inference, no balance used
npm run dev                    # http://localhost:3000
```

Put the key in `.env.local` yourself. Do not paste it into chat, commit it, or put it in a `NEXT_PUBLIC_*` variable. `.env.local` is Git-ignored.

Without `JEV_AI_API_KEY` the app still runs, using a mock provider (see section 8).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Vitest, no network, no API key needed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run jev:verify` | Checks the pinned destination, then calls `GET /v1/models`. Reports whether `jev-latest` is listed. Never runs inference |
| `npm run jev:decision` | Does the model check, then makes exactly ONE small billable decision call. Writes `.jev-decision-check.json` first and refuses to run again unless `--force` is passed |

Scripts load `.env.local` through `tsx --env-file-if-exists`. Output never includes the key.

### Environment variables

Defined in `.env.example` (placeholders only):

| Variable | Required | Default | Notes |
|---|---|---|---|
| `JEV_AI_API_KEY` | For real reviews | none | Server-side only. Missing key means the mock provider is used |
| `JEV_API_BASE_URL` | No | `https://jev-ai.pro/api` | Must equal this value (a trailing slash is tolerated). Anything else throws a configuration error |
| `JEV_MODEL_NAME` | No | `jev-latest` | Sent as `model` on each decision request |
| `JEV_TIMEOUT_MS` | No | `30000` | Per-request timeout, must be 1000-120000. Not in `.env.example` |

Claude, access-control and limit variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CLAUDE_*`, `REVIEW_ACCESS_TOKEN`, ...) are documented in section 14 and `.env.example`.

### Deployment

1. Set `JEV_AI_API_KEY` (and optionally the others) in the host's environment or secret settings. Do not commit it.
2. Redeploy after any change to environment variables.
3. Verify connectivity with `GET /api/jev/health`. It returns the destination, model name and whether the model is available. It never returns credentials and never runs inference.
4. Use separate keys for development and production.

The in-memory rate limiter, daily Claude cap and duplicate-submission cache work per server instance. With several instances or serverless functions, replace them with a shared store. In production set `REVIEW_ACCESS_TOKEN`, or `/api/reviews` returns 503 (section 14).

---

## 3. JEV API facts (from the official docs)

Verified by reading https://jev-ai.pro/docs on 2026-11-03. Re-check the docs before relying on any detail.

**Authentication:** `Authorization: Bearer <JEV_AI_API_KEY>` on every call. The playground's browser cookie is not accepted by the public API.

**`POST /api/v1/systemone` request body**

| Field | Notes |
|---|---|
| `model` | Optional, defaults to `jev-latest` |
| `state` | Required: string, object or array. This is the data being judged |
| `questions` | Required: 1-64 entries, question id mapped to a definition. Ids: letters, digits, `.`, `-`, `_`, max 64 chars |
| `session_id`, `user` | Optional, 1-256 chars |
| `trace` | Optional, up to 64 fields and 8,192 bytes (not used here) |
| `judgeId`, `revision` | Saved-judge alternative to `questions` (not used here) |

Question types (each needs `type` and `instructions`):

- `noul`: yes/no. Optional `criteria` with `true` and `false` descriptions. Answer: `noul` (probability of yes, 0-1).
- `choice`: 2-255 option keys, each with a description or `null`. Answer: `choice`, `probabilities`, `confidence`.
- `score`: ordered array of 2-10 levels. Answer: `score`, `legend`, `probabilities`, `confidence`.

Response: `model`, `answers` (keyed by question id), `usage` with `input_tokens` and `output_tokens`. Billing is exposed through headers: `X-Jev-Run-Id`, `X-Jev-Billing`, `X-Jev-Paid-Input-Tokens-Used`, `X-Jev-Model-Multiplier`, `X-Jev-Credits-Charged`, `X-Jev-Tokens-Remaining`, `X-Jev-Credits-Remaining`. Output tokens are free. `usage.cost` is omitted, so a missing cost means unavailable, not zero.

**Limits:** request body max 256,000 bytes; 64 questions per request; account limit 1,000 requests per minute. Token limits are listed per model for other models. The docs do not state a token limit for `jev-latest`, so this project does not assume one. Per the docs, oversized input returns 422 and is not charged.

**Errors** (body: `{ "error": { "code", "message" } }`)

| Status | Meaning | Documented action |
|---|---|---|
| 400 | Unsupported `provider` routing field | Remove the field |
| 401 | Missing, invalid or revoked key | Check header and key |
| 402 | Insufficient balance or spending paused | Check account and billing |
| 404 | Wrong path, or saved judge missing | Check URL and ids |
| 409 | Saved judge revision changed | Re-read the judge |
| 422 | Invalid body, state, model or questions | Fix the request; do not retry unchanged |
| 429 | Rate or capacity limit | Back off, honor `Retry-After` |
| 502 / 503 | Model or upstream unavailable | Retry with bounded backoff |
| 504 | Upstream timeout | Check outcome before retrying |

Retry rules from the docs: use `maxRetries: 0` for decisions; after a timeout or dropped connection check usage before sending another POST; retry only after a confirmed failure, with bounded backoff; a confirmed failed run has its reserved balance refunded.

**Official SDK:** `@typesafe-ai/sdk` (the docs show 0.6.0; npm latest was 0.7.0 at the time of checking). Constructor options shown: `apiKey`, `baseURL: 'https://jev-ai.pro/api'` (the SDK appends `/v1/systemone`), `retry: { maxRetries: 0 }`. Only `client.systemOne(...)` is documented. The docs note the SDK may discard the billing fields.

### Why a direct HTTP client instead of the SDK

The repository was empty, so there was no existing SDK client to reuse. The docs name the SDK but also document the HTTP endpoint directly. A small `fetch` client was chosen because it:

- keeps the billing headers (run id, credits charged and remaining) that the SDK may drop
- gives exact control over timeouts, redirects and the no-retry rule
- avoids a dependency for a single endpoint

Switching to the SDK later is possible: it would need the same `baseURL` as well as the key (setting only the key is not enough). The SDK is not installed.

---

## 4. Architecture

```
src/
  app/
    layout.tsx, page.tsx, globals.css      UI shell
    api/reviews/route.ts                   POST: validate, rate-limit, run review
    api/jev/health/route.ts                GET: model-list check only
    api/review/capabilities/route.ts       GET: which modes can run (no secrets)
  components/
    review-app.tsx                         client: input modes, editor, submit/cancel
    result-view.tsx                        client: summary, code pane, findings list
  lib/
    jev/                                   everything JEV-specific
      config.ts   errors.ts   schemas.ts   client.ts   index.ts
    review/                                provider-agnostic review logic
      types.ts   diff.ts   sources.ts   engine.ts   hybrid.ts   dedupe.ts   service.ts
    claude/                                everything Claude-specific
      config.ts   errors.ts   schema.ts   client.ts   prompt.ts   redact.ts   usage.ts   index.ts
    security/access.ts, limits.ts          access token, rate limits, daily Claude cap
    validation/review-input.ts             request validation and file rules
scripts/verify-jev.ts                      model check + single decision call
tests/jev.test.ts, tests/review.test.ts
```

Stack: Next.js 16 (App Router), React 19, TypeScript 7 (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, Monaco (`@monaco-editor/react`), Lucide icons, Zod 4, Vitest 5, tsx.

Server components render the static shell; interactive editor and results are client components; all review work happens in route handlers. JEV code is isolated in `src/lib/jev/` so it can be tested with mocked `fetch`.

### 4.1 `src/lib/jev/`

- `config.ts`: `loadJevConfig(env)` reads the key, pins the base URL to `https://jev-ai.pro/api`, sets model and timeout. Throws `JevConfigError` for a missing key, a different base URL or a bad timeout.
- `errors.ts`: `JevError` with a `kind` (`config`, `auth`, `insufficient_balance`, `invalid_request`, `not_found`, `conflict`, `rate_limited`, `upstream_unavailable`, `outcome_unknown`, `malformed_response`), an HTTP status, a `retryable` flag and an optional `retryAfterMs`. `errorFromStatus` maps the documented statuses. Messages are safe to show to users and never contain secrets or submitted code. `outcomeUncertain` is true for `outcome_unknown`.
- `schemas.ts`: Zod schemas for question types, the decision request (including the 64-question and 256,000-byte limits) and the response (including answer types), plus the model-list response. `validateDecisionRequest` runs before anything is sent.
- `client.ts`: `JevClient` with an injectable `fetch`.
  - Every request has an `AbortController` timeout, `Authorization` header and `redirect: "error"`.
  - Network failures and timeouts become `outcome_unknown`; the underlying exception text is discarded.
  - `listModels()` is read-only and retries at most twice on 429/502/503 (backoff capped at 5 seconds, honoring `Retry-After`).
  - `decide()` makes exactly one attempt. It rejects responses whose shape is wrong, that miss an answer for any question, or whose answer type differs from the question type.
  - Billing headers are returned as `{ runId, creditsCharged, creditsRemaining, tokensRemaining }`.

### 4.2 `src/lib/review/`

- `types.ts`: the internal contract (Zod): `Finding`, `ReviewResult`, `Focus`, `SourceFile`. This is an application schema, not a JEV-native format.
- `diff.ts`: `parseUnifiedDiff` handles `diff --git` headers, `---`/`+++` paths, `/dev/null`, renames, multi-hunk files, hunk headers with omitted counts, "\ No newline" markers, CRLF and binary markers. It tracks old and new line numbers for each line. It throws when no diff structure is found.
- `sources.ts`: `sourceFromCode` (full file with line numbers) and `sourcesFromDiff` (new-side lines, the set of added lines, and a renderer showing `+` for added lines and `-` for removed lines). Deleted files are dropped; binary or hunk-less files are reported as skipped.
- `engine.ts`: region planning, question building, provider calls, normalization (section 5).
- `service.ts`: `performReview` chooses the provider (JEV when a key exists, mock otherwise), validates Claude availability for the requested `analysis` mode, applies the daily cap, and `safeError` maps JEV and Claude errors to a safe HTTP status and message.
- `hybrid.ts`: `runHybridReview` runs the JEV engine, then optional Claude analysis (section 14). `dedupe.ts`: duplicate-submission protection.

### 4.3 API routes

`POST /api/reviews`

```json
{ "mode": "paste" | "upload", "filename": "a.ts", "code": "...", "focus": "general" }
{ "mode": "diff", "diff": "diff --git ...", "focus": "security" }
```

Order of checks: access token, rate limit (10 per minute per caller, plus 3 per minute for thorough reviews; in-memory), Zod validation, duplicate-submission check, then the review. The body also takes `analysis`: `jev_only` | `standard` (default) | `thorough`. Responses: 200 with the review result, 422 for invalid input or an unparsable diff, 429 for the local limiter or JEV rate limit, 503 for a missing key/config, 502 for other JEV failures (the message says when the outcome is uncertain), 500 for anything else (generic "Review failed.").

`GET /api/jev/health` returns `{ destination, model, modelAvailable }` or a 503 with a generic message.

`/api/reviews` is protected by a shared access token (`REVIEW_ACCESS_TOKEN`) and refuses to run in production without one. This is not per-user authentication; see section 14 before any public deployment. The health and capabilities routes are unauthenticated and return no secrets.

---

## 5. How a review works

JEV answers structured questions: it is not a chat or text-generation API. It cannot return free-form explanations, impact statements, fixes or corrected code. The engine uses a multi-question strategy within the documented limits:

1. **Plan regions.** Whole files are split into 20-line windows. For diffs, a region starts 3 lines before a changed line and spans 20 lines, and consecutive changed lines inside it are covered by the same region. Regions never start from unchanged-only code in a diff.
2. **Build questions.** For each region and category there is one `choice` question with options `none`, `low`, `medium`, `high`, `critical`. The instructions name the file, the line range and the defect type, say the content is untrusted data to analyze, and say to answer `none` without clear evidence. For diffs they add: only report defects introduced by or directly affected by added (`+`) lines.
   - General focus uses four categories: bug, security, performance, maintainability. A specific focus uses one category.
   - Question ids look like `r3_security`.
3. **One request per file.** `state` is `{ file, code }` where the code is rendered with line numbers (`   12| code`). Diff lines carry `+` for added lines and `-` for removed lines.
4. **Limits.** At most 64 questions per request, so with four categories at most 16 regions per file (64 with one category). Extra regions are not analyzed, and the review is marked incomplete with a limitation naming the file. At most 10 files per diff; the rest are skipped and reported.
5. **Interpret answers.** A region is flagged when the chosen option is not `none` and the probability of `none` is below 0.5. Severity is the option JEV chose. `confidence` is `1 - P(none)`: the model's probability that an issue exists, not a measured accuracy.
6. **Normalize.** Each flagged region becomes a finding with the file path and line range. In diffs, the start line is the first added line in the region, so findings cannot point at unchanged lines only. Findings are sorted by severity and checked against the Zod result schema.

### Finding shape

```
id, title, severity (critical|high|medium|low|informational),
category (bug|security|performance|maintainability|testing),
file_path, start_line, end_line, description,
impact: null, suggested_fix: null, suggested_code: null   // unavailable from JEV
confidence: number | null
```

The title is generic ("Possible security issue (critical)") and the description says that JEV classified the lines and returns classifications, not explanations. This is deliberate: the model output does not contain an explanation, and one is not invented. `informational` and `testing` exist in the schema but the engine does not currently produce them.

### Review result

`summary`, `overall_assessment` (`pass`, `concerns`, `needs_attention` or `null`), `status` (`complete` or `incomplete`), `provider` (`jev` or `mock`), `model`, `findings`, `positive_observations` (always empty: JEV is not asked for these), `limitations`, and `files` (path and line text, used by the code pane).

`overall_assessment` is `null` when the review is incomplete or comes from the mock provider. It is `pass` only for a complete JEV review with zero flagged regions, and the UI labels that "No regions flagged", with a summary that says it does not prove the code is correct. High or critical findings give `needs_attention`; lower severities give `concerns`.

### Cost

JEV charges credits per run. One real review costs one request per file. Use `npm run jev:decision` sparingly: it is intentionally limited to one call. During development 2 real calls were made (the verification call and one test review).

---

## 6. User interface

- **Input modes:** Paste code (Monaco editor, language selector, 16 languages), Upload file (read in the browser, shown read-only before review, removable), Git diff (Monaco in diff mode).
- **Focus selector:** General, Bug detection, Security, Performance, Maintainability.
- **Controls:** byte counter against the limit, Review button (disabled when empty or over the limit), Cancel while running, 90-second client timeout. A timeout or cancel shows a message warning that the request may still have been processed.
- **Results summary:** assessment banner (amber for incomplete or mock, neutral for no flags, red for needs attention), finding count, model name, severity counts, summary text and a list of limitations.
- **Split pane:** read-only Monaco showing the reviewed source (a file picker appears for multi-file diffs) and the findings list.
- **Findings list:** search, severity filter, category filter, expandable details, file and line reference. Clicking a finding opens the file, scrolls to its first line and highlights its range (amber for flagged ranges, blue for the active one). Copy button, Resolve and Ignore toggles (kept in the browser's memory only; lost on refresh).
- **Honest empty states:** "Nothing was flagged." versus "No findings match the filters."
- **Theming:** light and dark follow `prefers-color-scheme`, including Monaco. There is no manual toggle.
- **Accessibility:** tabs use `role="tab"`, controls have labels, errors use `role="alert"`, focus rings are visible. No full audit has been done.

Model output is rendered as React text (no `dangerouslySetInnerHTML`).

---

## 7. Input rules

Server-side validation (`src/lib/validation/review-input.ts`):

- Maximum 100,000 bytes of input (UTF-8).
- Upload and paste modes need a filename with an allowed extension: ts, tsx, js, jsx, mjs, cjs, py, rb, go, rs, java, kt, swift, c, h, cpp, hpp, cs, php, sh, sql, html, css, scss, json, yaml, yml, toml, md, txt, vue, svelte.
- Filenames cannot contain backslashes, NUL bytes or `../`, and are at most 255 characters.
- Input containing a NUL byte is rejected as binary.
- Empty input is rejected.
- Files are never executed or written to disk. The upload is read in the browser and sent as text; one file per upload.
- The client repeats the size and binary checks for fast feedback, but the server is the authority.

---

## 8. Mock provider

If `JEV_AI_API_KEY` is empty, the engine uses a deterministic placeholder. It marks security regions as medium when the text contains `eval(` or `innerHTML` and answers `none` for everything else. Its results are labelled "Unverified (mock provider)", include a limitation saying so, and never produce `pass`. It exists so the UI and tests work without spending balance. It is not a review.

---

## 9. Security and privacy

- The API key is read only in server code (`process.env`), through `loadJevConfig`. It is never in client bundles, URLs, logs or responses, and no `NEXT_PUBLIC_` variable holds it.
- The Authorization header is never logged. JEV error text and exception messages are discarded; users see fixed messages per error kind.
- The destination is pinned. Redirects are disabled for JEV calls, so a redirect cannot send the key elsewhere.
- Submitted code is treated as untrusted data. It is passed in `state`, and every question tells the model to ignore instructions inside it. This reduces prompt-injection risk but cannot guarantee immunity, and a malicious comment could still influence an answer.
- Code is never executed. Reviews are not stored (no database yet). Nothing is logged about submitted code.
- **Disclosure:** source code submitted for review is sent to the JEV API (jev-ai.pro) for analysis. The page header says so, and when Claude analysis is used the code is also sent to Anthropic (section 14). Check JEV's own terms for how it handles data; this project does not know its retention policy.
- Request size, file type, rate and question-count limits are enforced.
- No repository writes, commits, merges or comments are made anywhere.
- Retention and deletion: nothing persists, so there is nothing to delete. When history is added, deletion of a user's own reviews will be part of that phase.

---

## 10. Errors and uncertain outcomes

| Situation | What the app does |
|---|---|
| Missing key | Uses the mock provider, labelled. The health route returns 503 |
| Invalid input | 422 with a specific message, nothing sent to JEV |
| JEV 401 / 402 | 502 with a message about authentication or balance. No retry |
| JEV 422 / 400 | 422, "rejected the request as invalid". No retry |
| JEV 429 | 429, "try again shortly". Not retried automatically for decisions |
| JEV 502 / 503 | 502, "temporarily unavailable". Not retried automatically for decisions |
| JEV 504, timeout, dropped connection | 502 with a warning that the request may still have been processed; do not resubmit until usage is checked |
| 200 with a malformed body | `malformed_response`. The run happened and may have been billed, so it is not retried |

The `retryable` flag on `JevError` records which statuses the docs say may be retried after a wait, but decisions are never retried automatically. Only the read-only model list retries (twice at most).

---

## 11. Tests

`npm test` runs 63 tests with mocked providers (the 21 JEV/review tests described here plus 42 for the Claude layer, listed in section 14). No API key is needed and no balance is used.

`tests/jev.test.ts` (12):
- config requires the key and pins the destination (including a trailing slash)
- model list parsing and Bearer authentication to `https://jev-ai.pro/api/v1/models`
- decision request URL, model and body, and billing header parsing
- status mapping for 401, 402, 422, 429, 504, with exactly one attempt each
- a network failure is an uncertain outcome, is not retried, and does not leak the underlying message
- malformed or mismatched responses are rejected
- the model list retries a bounded number of times
- request validation: question limits and 256,000-byte body limit

`tests/review.test.ts` (9):
- diff parsing and new/old line numbers, non-diff rejection, binary file skipping
- diff regions start only at changed lines
- flagged regions normalize to exact lines and pass Zod validation
- the mock provider never yields `pass`
- over-limit files are marked incomplete, not passed
- diff findings stay inside changed regions
- input validation: bad extension, binary content, oversize input

Also verified manually: typecheck, production build, `GET /api/jev/health` through the running app, a real diff review (SQL concatenation plus `eval`) that returned a critical security finding at lines 2-6, and a rejected `.exe` upload.

Not yet tested: the results screen with live data in a browser, the file upload path in the browser, cancel and timeout behavior, multi-file diffs against real JEV, dark mode appearance, any behavior at scale or under concurrency, and accessibility with a screen reader.

---

## 12. Known limitations

- Findings are region-level classifications. They locate where JEV sees a problem and its severity but do not explain what is wrong. Impact, fixes and code are unavailable.
- Quality is unmeasured. Only synthetic inputs have been tried, so false positives and misses are unknown. The probability shown is not an accuracy figure.
- A flagged region can be up to 20 lines, so line ranges are coarse.
- Large files are only partly analyzed (16 regions per file in general focus, 320 lines), and the review is marked incomplete. Splitting a file into several requests is possible but would multiply cost and has not been built.
- The `jev-latest` token limit is undocumented. A very large `state` may be rejected with 422.
- No per-user authentication (shared token only), no persistence, no history, no dashboard. Resolve/ignore resets on refresh.
- No GitHub integration, webhooks or PR comments.
- The rate limiter, daily Claude cap and dedupe cache are per instance; the caller IP comes from a client-suppliable header unless your proxy overwrites it.
- Monaco loads its code from a CDN (jsdelivr) by default, so the editor needs internet access.
- shadcn/ui and ESLint were not added.
- Duplicate-submission protection is in-memory and per instance: identical submissions are replayed for a short window, but a different instance or a restart will bill again.
- The `testing` and `informational` categories exist in the schema but are not produced.

---

## 13. Roadmap

**Phase 3: persistence and history.** Add authentication (Auth.js), PostgreSQL with Prisma, review records, history page with search, reopen and delete, dashboard counts computed from stored data only, saved resolve/ignore state, ownership checks on every operation, and durable duplicate-submission protection. Replace the in-memory rate limiter and shared token.

**Phase 4: GitHub, read-only.** A GitHub App with least-privilege read permissions, repository selection, PR listing and details, changed-file and diff retrieval, size and type validation, reviewing a PR through the same engine, and results shown in the app. No comments are posted.

**Phase 5: publishable reviews.** Optional inline PR comments after explicit user approval, validated against GitHub's current review-comment and diff-position rules, idempotency, stale-revision handling, and webhook signature verification and delivery de-duplication if webhooks are added.

**Phase 6: hardening.** Linting, more tests (ownership, GitHub boundaries, UI states), security review, and deployment configuration.


---

## 14. Claude analysis layer (hybrid review)

JEV classifies regions; Claude (Anthropic Messages API, `@anthropic-ai/sdk`, server-side only) assesses whether each flagged region is substantiated and adds evidence, impact, a fix and suggested code. JEV remains the first stage and is unchanged. Nothing here claims the hybrid is more accurate than JEV alone: that has not been evaluated on a reproducible test set.

### Review modes (`analysis` field of `POST /api/reviews`, default `standard`)

| Mode | What runs | Provider usage |
|---|---|---|
| `jev_only` | The existing JEV review | JEV: one request per file. Claude: none |
| `standard` | JEV, then Claude on the flagged regions only (code window = region ± `CLAUDE_CONTEXT_LINES`, overlapping windows merged, batched up to `CLAUDE_MAX_CANDIDATES_PER_REQUEST` per request) | JEV as above. Claude: 0 requests if JEV flags nothing; otherwise at most `CLAUDE_MAX_REQUESTS_PER_REVIEW` |
| `thorough` | JEV, then Claude reads the whole submitted code (or the diff's changed hunks) in chunks of up to `CLAUDE_MAX_CONTEXT_CHARS`, also assessing any JEV candidates in the chunk | Claude: one request per chunk, up to the same cap. Always at least one request. The UI requires an explicit confirmation |

Exact token and cost figures depend on the code and model, so none are promised here. Every result reports actual `usage.input_tokens`/`output_tokens` per review and a **list-price estimate** (not a billed amount); when a response lacks usage the figure is shown as unavailable, never zero.

Explicitly requesting `standard` or `thorough` while Claude is not configured, disabled, or (for standard) JEV is not configured returns a clear 503; it never silently degrades. The UI reads `GET /api/review/capabilities` and only offers modes that can run.

### Setup

```bash
cp .env.example .env.local
# edit .env.local: set ANTHROPIC_API_KEY and ANTHROPIC_MODEL (and JEV_AI_API_KEY)
```

Production: set the same variables in the host's secret/environment settings and redeploy. Never use `NEXT_PUBLIC_*`, never commit `.env.local`, never paste keys in chat or tickets. Use separate keys for development and production.

**Disable Claude immediately:** set `CLAUDE_ANALYSIS_ENABLED=false` and redeploy/restart. JEV-only keeps working. Removing `ANTHROPIC_API_KEY` has the same effect.

### Choosing a model

`ANTHROPIC_MODEL` is required and is read in one place (`src/lib/claude/config.ts`). `.env.example` suggests `claude-sonnet-5-5` ($2 / $10 per million input / output tokens when this was written, 2026-10-06): the Sonnet tier is a mid-cost choice for structured code analysis. `claude-opus-5-5` ($4 / $20) is the more capable option and roughly doubles cost per token; `claude-haiku-5-5` ($0.10 / $0.50) is far cheaper but weaker at subtle defects. These trade-offs are general expectations from the model tiers, not results measured on this app. Check https://platform.claude.com/docs for current model IDs and prices. Built-in prices can go stale: override them with `ANTHROPIC_INPUT_PRICE_PER_MTOK` / `ANTHROPIC_OUTPUT_PRICE_PER_MTOK`. A model with no known or configured price is refused, because the per-review budget could not be enforced.

`ANTHROPIC_EFFORT` (default `medium`) sets `output_config.effort`, which limits thinking-token spend; thinking tokens count as output tokens and are bounded by `CLAUDE_MAX_OUTPUT_TOKENS`.

### How the Anthropic API is used

`messages.create` with `output_config.format` (JSON schema generated from the Zod schema by the SDK's `zodOutputFormat`), then the text is parsed and validated again with Zod. The SDK client is created with `maxRetries: 0` and a timeout (`CLAUDE_TIMEOUT_MS`), so no request is ever retried automatically: a timeout is an uncertain outcome (it may have been billed) and is reported as such. `stop_reason` `refusal` and `max_tokens` are treated as failures of that batch. Source code is wrapped in `<untrusted_code>` tags, the system prompt says to treat it as data, and a closing tag inside submitted code is neutralised. This reduces prompt-injection risk but cannot guarantee immunity.

### Cost controls (all server-side, in `src/lib/claude/config.ts` and `usage.ts`)

- Request cap per review (`CLAUDE_MAX_REQUESTS_PER_REVIEW`), output-token cap, per-request context cap, candidates-per-request cap, bounded concurrency.
- Budget per review (`CLAUDE_MAX_BUDGET_USD_PER_REVIEW`): before each request its worst-case cost (conservatively estimated input tokens plus the full output cap) is reserved; if actual spend plus reservations would exceed the budget, no more requests start and the result is marked partial. The input estimate is a heuristic, so overshoot is bounded by estimate error, not impossible.
- Daily per-instance Claude request cap (`REVIEW_DAILY_CLAUDE_REQUEST_CAP`).
- Standard mode makes no Claude call when JEV flags nothing.
- Duplicate submissions: identical submissions from the same caller share one in-flight run; a finished result is replayed for `REVIEW_DEDUPE_TTL_SEC` (marked `cached`); an uncertain failure blocks an immediate resubmission for 60 s. The UI also ignores double clicks.
- Missing usage is reported as unavailable; unknown usage is counted at worst case against the budget.

### Merging and validation

- Model file paths and line numbers are never trusted: a range is accepted only if the file was submitted and every referenced line was part of the code sent. Otherwise a JEV finding keeps its region and is labelled `uncertain`; a Claude-only finding with unverifiable lines is dropped and counted in the limitations.
- Each JEV candidate ends up as: validated (enhanced), rejected (kept in a separate "not substantiated" list with Claude's reason, plus a disagreement entry), or unresolved (stays visible, labelled unverified).
- Thorough mode merges a Claude finding into an existing finding when file, category and lines overlap (stronger severity kept, both providers listed); overlapping findings of different categories stay separate.
- Anything not analyzed (request cap, budget, size, failure) makes the result `incomplete` with the unanalyzed regions listed, and no `pass` is ever given for an incomplete review.

### Data handling

Submitted code is sent to JEV, and in `standard`/`thorough` also to Anthropic. Before sending to Claude, obvious secrets (common key formats, private-key blocks, credentials in URLs, secret-named assignments) are masked on a best-effort basis; this does not catch every secret. Only the relevant excerpts are sent, not the repository. This app stores nothing durable (results of recent identical submissions are kept in memory for the dedupe window). This project does not state either provider's retention or training policy: consult their terms and your organisation's rules. Suggested code is shown as a preview with a copy button and is never applied, executed, committed or merged.

### Access control (read before deploying publicly)

`/api/reviews` now requires `REVIEW_ACCESS_TOKEN` (a shared secret sent as `Authorization: Bearer ...`, entered in the UI and kept in `sessionStorage`). In production (`NODE_ENV=production`) the endpoint returns 503 until it is set, unless `ALLOW_UNAUTHENTICATED=true`. This is a shared secret, **not per-user authentication**: it gives no per-user limits, revocation or audit trail. Rate limits (10 reviews/min, 3 thorough/min per caller) and the daily cap are in-memory and per instance; with several instances or serverless functions each keeps its own counters, so use a shared store such as Redis first. The caller IP comes from `x-forwarded-for`, which a client can spoof unless your proxy overwrites it.

### Remaining deployment blockers

1. Per-user authentication and per-user quotas (phase 3). The shared token is a stopgap for a small trusted group.
2. Shared rate limiting / daily cap / dedupe store if running more than one instance.
3. The Claude path has only been tested with mocked responses: run a few reviews against the real API (with a low `CLAUDE_MAX_BUDGET_USD_PER_REVIEW`) and confirm structured output works on your chosen model before relying on it.
4. The results screen with live data has still not been checked in a browser.
5. Quality of the hybrid has not been measured; build an evaluation set before making accuracy claims.
6. Monaco still loads from a CDN, and ESLint is not configured.

### Tests

`npm test` (63 tests, all mocked, no keys or network): config and missing-key behaviour, request construction, structured-response validation, validated/rejected/unresolved candidates, invalid line references and file paths, prompt-injection text, redaction, standard mode skipping Claude, thorough mode independent findings and dedup, provider disagreements, request and budget limits, failures/timeouts/uncertain outcomes, duplicate submissions, access control, rate and daily limits, JEV-only operation, and rendering of the new finding fields and usage notices.
