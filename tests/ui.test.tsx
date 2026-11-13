import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalysisNotice, FindingDetails, OriginBadge } from "@/components/finding-details";
import { reviewResult } from "@/lib/review/types";

const base = {
  id: "f1", title: "SQL injection", severity: "high" as const, category: "security" as const, file_path: "a.ts", start_line: 3, end_line: 4,
  description: "Concatenated query.", impact: "Data exposure", suggested_fix: "Use parameters", suggested_code: "db.query(sql, [id]);",
  confidence: 0.9, providers: ["jev", "claude"] as ("jev" | "claude")[], origin: "jev_enhanced" as const, claude_verdict: "validated" as const,
  evidence: "line 3 concatenates input", uncertainty: "Caller unknown", claude_confidence: "medium" as const, location_precision: "verified" as const, jev_severity: null,
};

describe("findings UI", () => {
  it("shows provider, verdict, impact, fix, preview-only suggested code and honest confidence labels", () => {
    const html = renderToStaticMarkup(<><OriginBadge finding={base} /><FindingDetails finding={base} /></>);
    expect(html).toContain("JEV + Claude");
    expect(html).toContain("Claude validated this JEV candidate");
    expect(html).toContain("Data exposure");
    expect(html).toContain("Use parameters");
    expect(html).toContain("preview only, never applied automatically");
    expect(html).toContain("Copy code");
    expect(html).toContain("not a measured accuracy");
    expect(html).toContain("Caller unknown");
  });
  it("labels JEV-only and unresolved findings without inventing explanations", () => {
    const f = { ...base, impact: null, suggested_fix: null, suggested_code: null, evidence: null, uncertainty: null, claude_confidence: null, providers: ["jev" as const], origin: "jev_only" as const, claude_verdict: "unresolved" as const, location_precision: "region" as const };
    const html = renderToStaticMarkup(<><OriginBadge finding={f} /><FindingDetails finding={f} /></>);
    expect(html).toContain("JEV only");
    expect(html).toContain("Unverified");
    expect(html).toContain("not available for this finding");
    expect(html).not.toContain("Copy code");
  });
  it("discloses providers and reports unavailable usage/cost rather than zero", () => {
    const result = reviewResult.parse({
      summary: "s", overall_assessment: null, status: "incomplete", provider: "jev", model: "m", findings: [], positive_observations: [], limitations: [], files: [],
      analysis_mode: "standard", data_sent_to: ["jev", "anthropic"],
      claude: { status: "partial", model: "claude-sonnet-5-5", redactions: 0, usage: { requests_attempted: 1, requests_completed: 0, input_tokens: null, output_tokens: null, usage_complete: false, estimated_cost_usd: null, budget_usd: 0.25, stopped_reason: "budget" } },
    });
    const html = renderToStaticMarkup(<AnalysisNotice result={result} />);
    expect(html).toContain("sent to JEV and Anthropic");
    expect(html).toContain("unavailable/unavailable");
    expect(html).toContain("cost unavailable");
    expect(html).toContain("stopped: budget");
    expect(html).toContain("usage incomplete");
  });
});
