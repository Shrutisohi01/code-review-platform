import {
  ClaudeAnalyzer,
  ClaudeConfig,
  ClaudeError,
  ClaudeFinding,
  PromptCandidate,
  PromptUnit,
  SYSTEM_PROMPT,
  UsageTracker,
  buildUserPrompt,
  prepareCode,
} from "@/lib/claude";
import { DecisionProvider, runReview } from "./engine";
import { AnalysisMode, Category, Finding, Focus, ReviewResult, Severity, SourceFile, reviewResult } from "./types";

type Limits = Pick<
  ClaudeConfig,
  "maxRequests" | "maxCandidatesPerRequest" | "maxContextChars" | "contextLines" | "maxOutputTokens" | "maxBudgetUsd" | "concurrency" | "pricing"
>;

export interface HybridArgs {
  sources: SourceFile[];
  skipped?: string[];
  focus: Focus;
  analysis: AnalysisMode;
  jev: DecisionProvider;
  /** null = Claude not available; only valid with analysis "jev_only". */
  claude: ClaudeAnalyzer | null;
  limits: Limits;
}

const SEV: Severity[] = ["informational", "low", "medium", "high", "critical"];
const MAX_SUGGESTED_CODE = 4000;
const MAX_TEXT = 1500;
const clip = (s: string | null, n = MAX_TEXT) => (s === null ? null : s.length > n ? s.slice(0, n) + "…" : s);

interface Unit extends PromptUnit {
  candidateIds: string[];
}
interface Batch {
  units: Unit[];
  candidates: PromptCandidate[];
}

/** Standard mode: one window of surrounding code per flagged region; overlapping windows in a file are merged. */
function candidateUnits(sources: SourceFile[], cands: Finding[], ctx: number, maxIds: number): { units: Unit[]; redactions: number } {
  const units: Unit[] = [];
  let redactions = 0;
  for (const src of sources) {
    const mine = cands.filter((c) => c.file_path === src.path).sort((a, b) => a.start_line - b.start_line);
    const maxLine = Math.max(...src.lines.keys());
    let cur: { s: number; e: number; ids: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const r = prepareCode(() => src.render(cur!.s, cur!.e));
      redactions += r.redactions;
      units.push({ path: src.path, start: cur.s, end: cur.e, code: r.code, candidateIds: cur.ids });
      cur = null;
    };
    for (const c of mine) {
      const s = Math.max(1, c.start_line - ctx);
      const e = Math.min(maxLine, c.end_line + ctx);
      if (cur && s <= cur.e + 1 && cur.ids.length < maxIds && e - cur.s < 150) {
        cur.e = Math.max(cur.e, e);
        cur.ids.push(c.id);
      } else {
        flush();
        cur = { s, e, ids: [c.id] };
      }
    }
    flush();
  }
  return { units, redactions };
}

/** Thorough mode: the whole relevant source, cut into chunks that each fit one request. */
function fullUnits(sources: SourceFile[], cands: Finding[], maxChars: number): { units: Unit[]; redactions: number } {
  const units: Unit[] = [];
  let redactions = 0;
  const budget = Math.floor(maxChars * 0.9); // headroom for prompt text
  for (const src of sources) {
    const nums = [...src.lines.keys()].sort((a, b) => a - b);
    let first = 0;
    let size = 0;
    const emit = (lastIdx: number) => {
      const s = nums[first]!;
      const e = nums[lastIdx]!;
      const r = prepareCode(() => src.render(s, e));
      redactions += r.redactions;
      const ids = cands.filter((c) => c.file_path === src.path && c.start_line >= s && c.start_line <= e).map((c) => c.id);
      units.push({ path: src.path, start: s, end: e, code: r.code, candidateIds: ids });
    };
    nums.forEach((n, i) => {
      const len = (src.lines.get(n)?.length ?? 0) + 8;
      if (size + len > budget && i > first) {
        emit(i - 1);
        first = i;
        size = 0;
      }
      size += len;
    });
    if (nums.length) emit(nums.length - 1);
  }
  return { units, redactions };
}

function pack(units: Unit[], cands: Finding[], l: Limits): { batches: Batch[]; overflow: Unit[]; capped: boolean } {
  const batches: Batch[] = [];
  const overflow: Unit[] = [];
  let cur: Unit[] = [];
  let chars = 0;
  let n = 0;
  const flush = () => {
    if (!cur.length) return;
    const ids = new Set(cur.flatMap((u) => u.candidateIds));
    batches.push({
      units: cur,
      candidates: cands.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, path: c.file_path, start: c.start_line, end: c.end_line, category: c.category, severity: c.severity })),
    });
    cur = [];
    chars = 0;
    n = 0;
  };
  for (const u of units) {
    if (u.code.length > l.maxContextChars) {
      overflow.push(u);
      continue;
    }
    if (cur.length && (chars + u.code.length > l.maxContextChars || n + u.candidateIds.length > l.maxCandidatesPerRequest)) flush();
    cur.push(u);
    chars += u.code.length;
    n += u.candidateIds.length;
  }
  flush();
  return { capped: batches.length > l.maxRequests, batches: batches.slice(0, l.maxRequests), overflow: [...overflow, ...batches.slice(l.maxRequests).flatMap((b) => b.units)] };
}

/** Verifies a model-reported range against the lines that were actually sent. Never trusts model line numbers. */
function checkLocation(f: ClaudeFinding, src: SourceFile | undefined, sent: Unit[]): { start: number; end: number } | null {
  if (!src || f.file_path !== src.path) return null;
  if (!Number.isInteger(f.start_line) || !Number.isInteger(f.end_line) || f.start_line < 1 || f.end_line < f.start_line) return null;
  const windows = sent.filter((u) => u.path === src.path);
  const inSent = (n: number) => src.lines.has(n) && windows.some((u) => n >= u.start && n <= u.end);
  if (!inSent(f.start_line) || !inSent(f.end_line)) return null;
  if (f.end_line - f.start_line > 60) return null; // implausibly broad: treat as unverified
  return { start: f.start_line, end: f.end_line };
}

const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }, slack = 2) => a.s <= b.e + slack && b.s <= a.e + slack;

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

export async function runHybridReview(a: HybridArgs): Promise<ReviewResult> {
  const base = await runReview(a.sources, a.focus, a.jev, { skippedFiles: a.skipped });
  const common = { analysis_mode: a.analysis, data_sent_to: base.data_sent_to };
  if (a.analysis === "jev_only" || !a.claude) {
    return reviewResult.parse({ ...base, ...common, analysis_mode: "jev_only" });
  }
  const claude = a.claude;
  const l = a.limits;
  if (!l.pricing) throw new Error("pricing required"); // loadClaudeConfig guarantees this

  const used = a.sources.filter((s) => base.files.some((f) => f.path === s.path));
  const thorough = a.analysis === "thorough";
  const candidates = base.provider === "mock" ? [] : base.findings;

  if (!thorough && candidates.length === 0) {
    return reviewResult.parse({
      ...base,
      ...common,
      summary: base.status === "complete" ? `${base.summary} Claude was not called because JEV flagged nothing (standard mode).` : base.summary,
      claude: { status: "skipped_no_candidates", model: null, redactions: 0, usage: null },
    });
  }

  const { units, redactions } = thorough ? fullUnits(used, candidates, l.maxContextChars) : candidateUnits(used, candidates, l.contextLines, l.maxCandidatesPerRequest);
  const { batches, overflow, capped } = pack(units, candidates, l);
  const tracker = new UsageTracker(l.pricing, l.maxBudgetUsd, l.maxRequests);

  type Answer = { batch: Batch; findings: ClaudeFinding[] };
  const answers: Answer[] = [];
  const failedBatches: Batch[] = [];
  const notes: string[] = [];
  const skippedBatches: Batch[] = [];
  const queue = [...batches];

  await pool(queue, l.concurrency, async (batch) => {
    const prompt = buildUserPrompt({ mode: a.analysis as "standard" | "thorough", diff: used.some((s) => s.changedLines), units: batch.units, candidates: batch.candidates });
    const reservation = tracker.tryStart(tracker.worstCase(SYSTEM_PROMPT.length + prompt.length, l.maxOutputTokens));
    if (reservation === null) {
      skippedBatches.push(batch);
      return;
    }
    try {
      const r = await claude.analyze({ system: SYSTEM_PROMPT, user: prompt });
      tracker.finish(reservation, r.usage, true);
      answers.push({ batch, findings: r.output.findings });
    } catch (e) {
      const err = e instanceof ClaudeError ? e : new ClaudeError("upstream_unavailable", "Claude request failed.");
      // Uncertain outcomes carry no usage, so the reserved worst case is counted as spent.
      tracker.finish(reservation, err.usage, false);
      failedBatches.push(batch);
      if (err.kind === "auth" || err.kind === "config" || err.kind === "invalid_request") tracker.stop("error");
      else if (err.kind === "rate_limited") tracker.stop("rate_limited");
      else if (err.outcomeUncertain) tracker.stop("uncertain_outcome");
      notes.push(`${err.message}`);
    }
  });

  if (capped) tracker.stop("request_limit");

  // ---- merge ----
  const byPath = new Map(used.map((s) => [s.path, s]));
  const sentOf = (b: Batch) => b.units;
  const claudeById = new Map<string, { f: ClaudeFinding; batch: Batch }>();
  const independent: { f: ClaudeFinding; batch: Batch }[] = [];
  let ignored = 0;
  for (const { batch, findings } of answers) {
    const ids = new Set(batch.candidates.map((c) => c.id));
    for (const f of findings) {
      if (f.candidate_id && ids.has(f.candidate_id)) {
        if (!claudeById.has(f.candidate_id)) claudeById.set(f.candidate_id, { f, batch });
      } else if (thorough && f.is_valid) independent.push({ f, batch });
      else ignored++;
    }
  }

  const active: Finding[] = [];
  const dismissed: Finding[] = [];
  const disagreements: ReviewResult["disagreements"] = [];

  for (const c of candidates) {
    const hit = claudeById.get(c.id);
    if (!hit) {
      active.push({ ...c, providers: ["jev"], claude_verdict: "unresolved", uncertainty: "Claude did not return a usable assessment for this candidate, so it is unverified." });
      continue;
    }
    const f = hit.f;
    if (!f.is_valid) {
      dismissed.push({
        ...c,
        providers: ["jev", "claude"],
        claude_verdict: "rejected",
        evidence: clip(f.evidence),
        uncertainty: clip(f.uncertainty),
        claude_confidence: f.confidence,
      });
      disagreements.push({ kind: "claude_rejected_jev_candidate", finding_id: c.id, message: `JEV flagged lines ${c.start_line}-${c.end_line} (${c.severity} ${c.category}); Claude could not substantiate it from the code shown.` });
      continue;
    }
    const loc = checkLocation(f, byPath.get(c.file_path), sentOf(hit.batch));
    const sev = SEV.includes(f.severity) ? f.severity : c.severity;
    if (sev !== c.severity) disagreements.push({ kind: "severity_differs", finding_id: c.id, message: `JEV classified this as ${c.severity}; Claude assessed ${sev}.` });
    active.push({
      ...c,
      title: clip(f.title, 200)!,
      severity: sev,
      category: f.category as Category,
      start_line: loc?.start ?? c.start_line,
      end_line: loc?.end ?? c.end_line,
      description: clip(f.description)!,
      impact: clip(f.impact),
      suggested_fix: clip(f.suggested_fix),
      suggested_code: f.suggested_code && f.suggested_code.length <= MAX_SUGGESTED_CODE ? f.suggested_code : null,
      providers: ["jev", "claude"],
      origin: "jev_enhanced",
      claude_verdict: "validated",
      evidence: clip(f.evidence),
      uncertainty: clip(f.uncertainty) ?? (f.suggested_code && f.suggested_code.length > MAX_SUGGESTED_CODE ? "Suggested code omitted: too long." : null),
      claude_confidence: f.confidence,
      location_precision: loc ? "verified" : "uncertain",
      jev_severity: sev !== c.severity ? c.severity : null,
    });
  }

  let badLocation = 0;
  for (const { f, batch } of independent) {
    const loc = checkLocation(f, byPath.get(f.file_path), sentOf(batch));
    if (!loc) {
      badLocation++;
      continue;
    }
    const sev = SEV.includes(f.severity) ? f.severity : "low";
    const range = { s: loc.start, e: loc.end };
    const twin = active.find((x) => x.file_path === f.file_path && x.category === f.category && overlaps({ s: x.start_line, e: x.end_line }, range));
    if (twin) {
      // Same problem seen again: merge instead of listing twice, keeping the stronger severity and both providers.
      if (twin.claude_verdict !== "validated" && twin.origin === "jev_only") {
        Object.assign(twin, {
          title: clip(f.title, 200)!, description: clip(f.description)!, impact: clip(f.impact), suggested_fix: clip(f.suggested_fix),
          suggested_code: f.suggested_code && f.suggested_code.length <= MAX_SUGGESTED_CODE ? f.suggested_code : null,
          providers: ["jev", "claude"], origin: "jev_enhanced", claude_verdict: "validated", evidence: clip(f.evidence), uncertainty: clip(f.uncertainty),
          claude_confidence: f.confidence, location_precision: "verified", start_line: loc.start, end_line: loc.end,
        });
      }
      if (SEV.indexOf(sev) > SEV.indexOf(twin.severity)) twin.severity = sev;
      continue;
    }
    const id = `claude:${f.file_path}:${loc.start}-${loc.end}:${f.category}`;
    active.push({
      id, title: clip(f.title, 200)!, severity: sev, category: f.category as Category, file_path: f.file_path,
      start_line: loc.start, end_line: loc.end, description: clip(f.description)!, impact: clip(f.impact), suggested_fix: clip(f.suggested_fix),
      suggested_code: f.suggested_code && f.suggested_code.length <= MAX_SUGGESTED_CODE ? f.suggested_code : null,
      confidence: null, providers: ["claude"], origin: "claude_independent", claude_verdict: null, evidence: clip(f.evidence),
      uncertainty: clip(f.uncertainty), claude_confidence: f.confidence, location_precision: "verified", jev_severity: null,
    });
    disagreements.push({ kind: "claude_only_finding", finding_id: id, message: `Claude reported an issue at lines ${loc.start}-${loc.end} that JEV did not flag.` });
  }

  // ---- coverage & status ----
  const limitations = [...base.limitations];
  const unreviewed = [...overflow, ...skippedBatches.flatMap((b) => b.units), ...failedBatches.flatMap((b) => b.units)];
  const completed = answers.length;
  const cstatus: ReviewResult["claude"]["status"] = unreviewed.length === 0 ? "complete" : completed > 0 ? "partial" : "failed";
  if (unreviewed.length) {
    const ranges = [...new Set(unreviewed.map((u) => `${u.path}:${u.start}-${u.end}`))];
    limitations.push(
      `Claude analysis is incomplete: ${ranges.length} region(s) were not analyzed${tracker.stopped ? ` (${tracker.stopped.replace("_", " ")})` : ""}: ${ranges.slice(0, 5).join(", ")}${ranges.length > 5 ? ", …" : ""}.`,
    );
  }
  for (const n of [...new Set(notes)]) limitations.push(`Claude: ${n}`);
  if (ignored) limitations.push(`${ignored} Claude entr${ignored === 1 ? "y" : "ies"} were ignored (not tied to a candidate or not valid).`);
  if (badLocation) limitations.push(`${badLocation} Claude finding(s) were dropped because their file/line references could not be verified against the submitted code.`);
  if (thorough) limitations.push("Thorough mode reviews only the code shown to Claude (changed hunks for diffs); it is not proof that the rest of the repository is free of defects.");
  if (base.provider === "mock" && thorough) limitations.push("JEV is not configured (mock provider), so no JEV candidates were used.");
  if (redactions) limitations.push(`${redactions} secret-like string(s) were masked before sending to Claude. Redaction is best-effort and does not catch every secret.`);

  const usage = tracker.report();
  if (!usage.usage_complete) limitations.push("Claude usage was not reported for every request; token and cost totals are lower bounds or unavailable.");
  active.sort((x, y) => SEV.indexOf(y.severity) - SEV.indexOf(x.severity));

  const incomplete = base.status === "incomplete" || cstatus !== "complete";
  const top = active.some((f) => f.severity === "critical" || f.severity === "high");
  const assessment = incomplete || base.provider === "mock" && !thorough ? null : active.length === 0 ? "pass" : top ? "needs_attention" : "concerns";
  const validated = active.filter((f) => f.claude_verdict === "validated").length;
  const independentCount = active.filter((f) => f.origin === "claude_independent").length;
  const summary = incomplete
    ? `Incomplete ${thorough ? "thorough" : "standard"} review: ${active.length} finding(s) so far; some code or candidates were not analyzed. See limitations.`
    : `${thorough ? "Thorough" : "Standard"} review: ${active.length} finding(s) — ${validated} JEV candidate(s) validated by Claude, ${independentCount} found only by Claude, ${dismissed.length} JEV candidate(s) not substantiated. Verify each finding; this is not proof of correctness.`;

  return reviewResult.parse({
    ...base,
    ...common,
    summary,
    overall_assessment: assessment,
    status: incomplete ? "incomplete" : "complete",
    findings: active,
    dismissed,
    disagreements,
    limitations,
    claude: { status: cstatus, model: claude.model, redactions, usage },
    data_sent_to: usage.requests_attempted > 0 ? [...base.data_sent_to, "anthropic"] : base.data_sent_to,
  });
}
