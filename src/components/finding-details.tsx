"use client";

import { Copy } from "lucide-react";
import type { Finding, ReviewResult } from "@/lib/review/types";

export const ORIGIN_LABEL: Record<Finding["origin"], string> = {
  jev_only: "JEV only",
  jev_enhanced: "JEV + Claude",
  claude_independent: "Claude only",
};
const ORIGIN_STYLE: Record<Finding["origin"], string> = {
  jev_only: "bg-zinc-500/20",
  jev_enhanced: "bg-emerald-500/20",
  claude_independent: "bg-violet-500/20",
};
const VERDICT_LABEL: Record<NonNullable<Finding["claude_verdict"]>, string> = {
  validated: "Claude validated this JEV candidate",
  rejected: "Claude could not substantiate this JEV candidate",
  unresolved: "Claude did not resolve this JEV candidate (unverified)",
};
const PRECISION_LABEL: Record<Finding["location_precision"], string> = {
  verified: "Line range cross-checked against the submitted code",
  region: "Region-level location (up to 20 lines, from JEV)",
  uncertain: "Line range from the model could not be verified; showing the JEV region",
};

export function OriginBadge({ finding }: { finding: Finding }) {
  const unresolved = finding.claude_verdict === "unresolved";
  return (
    <span className="inline-flex gap-1 text-xs">
      <span className={`rounded px-1.5 py-0.5 ${ORIGIN_STYLE[finding.origin]}`}>{ORIGIN_LABEL[finding.origin]}</span>
      {unresolved && <span className="rounded bg-amber-500/20 px-1.5 py-0.5">Unverified</span>}
    </span>
  );
}

/** Suggested code is shown as a preview only; nothing is ever applied automatically. */
export function SuggestedCode({ code }: { code: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs muted">
        <span>Suggested code (preview only, never applied automatically)</span>
        <button type="button" className="panel ml-auto inline-flex items-center gap-1 px-2 py-0.5" onClick={() => navigator.clipboard?.writeText(code)}>
          <Copy size={12} /> Copy code
        </button>
      </div>
      <pre className="panel overflow-auto p-2 text-xs" aria-label="Suggested code preview">
        {code.split("\n").map((l, i) => (
          <div key={i} className="text-emerald-600 dark:text-emerald-400">{`+ ${l}`}</div>
        ))}
      </pre>
    </div>
  );
}

export function FindingDetails({ finding: f }: { finding: Finding }) {
  return (
    <div className="space-y-2 text-sm">
      <p>{f.description}</p>
      {f.evidence && <p><span className="font-medium">Evidence: </span>{f.evidence}</p>}
      {f.impact && <p><span className="font-medium">Impact: </span>{f.impact}</p>}
      {f.suggested_fix && <p><span className="font-medium">Suggested fix: </span>{f.suggested_fix}</p>}
      {f.suggested_code && <SuggestedCode code={f.suggested_code} />}
      {!f.impact && !f.suggested_fix && !f.suggested_code && (
        <p className="muted">Impact, suggested fix and code are not available for this finding.</p>
      )}
      {f.uncertainty && <p className="muted"><span className="font-medium">Uncertainty: </span>{f.uncertainty}</p>}
      <ul className="space-y-0.5 text-xs muted">
        <li>Reported by: {f.providers.map((p) => (p === "jev" ? "JEV" : "Claude")).join(" + ")}</li>
        {f.claude_verdict && <li>{VERDICT_LABEL[f.claude_verdict]}</li>}
        {f.jev_severity && <li>JEV severity was {f.jev_severity}; Claude assessed {f.severity}.</li>}
        <li>{PRECISION_LABEL[f.location_precision]}</li>
        {f.confidence !== null && <li>JEV probability that an issue exists: {(f.confidence * 100).toFixed(0)}% (a model output, not a measured accuracy)</li>}
        {f.claude_confidence && <li>Claude self-reported confidence: {f.claude_confidence} (not a measured accuracy)</li>}
      </ul>
    </div>
  );
}

export function AnalysisNotice({ result }: { result: ReviewResult }) {
  const c = result.claude;
  const u = c.usage;
  const modeLabel = result.analysis_mode === "jev_only" ? "JEV-only" : result.analysis_mode === "standard" ? "Standard (JEV + Claude)" : "Thorough (independent Claude review)";
  const where = result.data_sent_to.length
    ? `Code was sent to ${result.data_sent_to.map((d) => (d === "jev" ? "JEV" : "Anthropic")).join(" and ")} for processing.`
    : "No code was sent to an external provider.";
  return (
    <div className="mt-2 space-y-1 text-xs muted" aria-label="Analysis details">
      <p>
        Mode: <strong>{modeLabel}</strong>
        {c.status !== "not_requested" && <> · Claude: {c.status.replace(/_/g, " ")}{c.model ? ` (${c.model})` : ""}</>}
        {result.cached && " · replayed from the duplicate-submission cache (no new provider calls)"}
      </p>
      {u && (
        <p>
          Claude usage: {u.requests_attempted} request(s), tokens in/out {u.input_tokens ?? "unavailable"}/{u.output_tokens ?? "unavailable"}
          {u.estimated_cost_usd !== null ? ` · estimated cost $${u.estimated_cost_usd.toFixed(4)} from list prices (not a billed amount)` : " · cost unavailable"}
          {" "}· budget ${u.budget_usd.toFixed(2)}
          {u.stopped_reason ? ` · stopped: ${u.stopped_reason.replace(/_/g, " ")}` : ""}
          {!u.usage_complete && " · usage incomplete"}
        </p>
      )}
      <p>{where}</p>
    </div>
  );
}
