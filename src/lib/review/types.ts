import { z } from "zod";

export const severity = z.enum(["critical", "high", "medium", "low", "informational"]);
export const category = z.enum(["bug", "security", "performance", "maintainability", "testing"]);
export type Severity = z.infer<typeof severity>;
export type Category = z.infer<typeof category>;

export const finding = z.object({
  id: z.string(),
  title: z.string(),
  severity,
  category,
  file_path: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  description: z.string(),
  impact: z.string().nullable(), // JEV returns classifications only; null = unavailable
  suggested_fix: z.string().nullable(),
  suggested_code: z.string().nullable(),
  /** Probability mass JEV put on "an issue exists" for this region. Not a measured accuracy. */
  confidence: z.number().min(0).max(1).nullable(),
  /** Which provider(s) contributed to this finding. */
  providers: z.array(z.enum(["jev", "claude"])),
  /** jev_only: JEV classification only. jev_enhanced: JEV candidate assessed by Claude. claude_independent: found by Claude alone. */
  origin: z.enum(["jev_only", "jev_enhanced", "claude_independent"]),
  /** Claude's verdict on a JEV candidate; null when Claude was not asked (JEV-only mode) or for Claude-only findings. */
  claude_verdict: z.enum(["validated", "rejected", "unresolved"]).nullable(),
  /** Code-based evidence given by Claude, or why a candidate could not be substantiated. */
  evidence: z.string().nullable(),
  /** Caveats / missing context reported by Claude. */
  uncertainty: z.string().nullable(),
  /** Claude's qualitative self-assessment. Not a measured accuracy. */
  claude_confidence: z.enum(["low", "medium", "high"]).nullable(),
  /** verified: range cross-checked against submitted lines. region: coarse JEV region. uncertain: model range could not be verified. */
  location_precision: z.enum(["verified", "region", "uncertain"]),
  /** JEV's own severity when Claude's differs. */
  jev_severity: severity.nullable(),
});
export type Finding = z.infer<typeof finding>;

export const analysisMode = z.enum(["jev_only", "standard", "thorough"]);
export type AnalysisMode = z.infer<typeof analysisMode>;

export const usageReport = z.object({
  requests_attempted: z.number().int(),
  requests_completed: z.number().int(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  usage_complete: z.boolean(),
  estimated_cost_usd: z.number().nullable(),
  budget_usd: z.number(),
  stopped_reason: z.enum(["budget", "request_limit", "error", "rate_limited", "uncertain_outcome"]).nullable(),
});

export const claudeSummary = z.object({
  status: z.enum(["not_requested", "skipped_no_candidates", "complete", "partial", "failed"]),
  model: z.string().nullable(),
  /** Secret-like strings masked before sending. Best effort only. */
  redactions: z.number().int(),
  usage: usageReport.nullable(),
});

export const disagreement = z.object({
  kind: z.enum(["claude_rejected_jev_candidate", "claude_only_finding", "severity_differs"]),
  finding_id: z.string(),
  message: z.string(),
});

export const reviewResult = z.object({
  summary: z.string(),
  /** null when the review did not establish a meaningful result (incomplete, failed, or mock). */
  overall_assessment: z.enum(["pass", "concerns", "needs_attention"]).nullable(),
  status: z.enum(["complete", "incomplete"]),
  provider: z.enum(["jev", "mock"]),
  model: z.string().nullable(),
  findings: z.array(finding),
  positive_observations: z.array(z.string()),
  limitations: z.array(z.string()),
  files: z.array(z.object({ path: z.string(), lines: z.record(z.string(), z.string()) })),
  analysis_mode: analysisMode.default("jev_only"),
  claude: claudeSummary.default({ status: "not_requested", model: null, redactions: 0, usage: null }),
  /** JEV candidates that Claude could not substantiate. Kept visible so uncertainty is not hidden. */
  dismissed: z.array(finding).default([]),
  disagreements: z.array(disagreement).default([]),
  /** Where the submitted code was sent for processing. */
  data_sent_to: z.array(z.enum(["jev", "anthropic"])).default([]),
  /** True when this response was served from the duplicate-submission cache (no new provider calls). */
  cached: z.boolean().default(false),
});
export type ReviewResult = z.infer<typeof reviewResult>;

export type Focus = "general" | "bug" | "security" | "performance" | "maintainability";
export const FOCUSES: Focus[] = ["general", "bug", "security", "performance", "maintainability"];

export interface SourceFile {
  path: string;
  /** Full text for code reviews; for diffs, the new-side lines known from the patch. */
  lines: Map<number, string>;
  /** Lines the review should attribute defects to; null = whole file. */
  changedLines: Set<number> | null;
  /** Rendered text sent to JEV for a region. */
  render(start: number, end: number): string;
}
