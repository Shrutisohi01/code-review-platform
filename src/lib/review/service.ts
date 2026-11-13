import { ClaudeAnalyzer, ClaudeConfig, ClaudeConfigError, ClaudeError, claudeAvailability, createClaudeAnalyzer, loadClaudeConfig, unavailableMessage } from "@/lib/claude";
import { JevClient, JevError, loadJevConfig } from "@/lib/jev";
import { ReviewInput } from "@/lib/validation/review-input";
import { dailyClaude } from "@/lib/security/limits";
import { DecisionProvider, jevProvider, mockProvider } from "./engine";
import { runHybridReview } from "./hybrid";
import { sourceFromCode, sourcesFromDiff } from "./sources";
import { Focus, ReviewResult } from "./types";

export class DailyLimitError extends Error {
  constructor() {
    super("The daily Claude request limit for this server has been reached. JEV-only reviews are still available.");
  }
}

export interface ReviewDeps {
  env?: Record<string, string | undefined>;
  jev?: DecisionProvider;
  claude?: ClaudeAnalyzer;
  claudeConfig?: ClaudeConfig;
}

export async function performReview(input: ReviewInput, deps: ReviewDeps = {}): Promise<ReviewResult> {
  const env = deps.env ?? process.env;
  const focus = input.focus as Focus;
  const analysis = input.analysis;
  const hasKey = !!env.JEV_AI_API_KEY?.trim();
  const jev = deps.jev ?? (hasKey ? jevProvider(new JevClient(loadJevConfig())) : mockProvider);

  let claude: ClaudeAnalyzer | null = null;
  let config: ClaudeConfig | null = null;
  if (analysis !== "jev_only") {
    // Explicitly requested Claude analysis never silently degrades to JEV-only.
    if (!deps.claude) {
      const a = claudeAvailability(env);
      if (!a.available) throw new ClaudeConfigError(unavailableMessage(a.reason));
    }
    if (analysis === "standard" && jev.name === "mock") {
      throw new ClaudeConfigError("Standard mode validates JEV findings, but JEV is not configured (JEV_AI_API_KEY). Use JEV-only or thorough mode.");
    }
    config = deps.claudeConfig ?? loadClaudeConfig(env);
    const cap = Number(env.REVIEW_DAILY_CLAUDE_REQUEST_CAP ?? 200);
    const remaining = dailyClaude.remaining(cap);
    if (remaining <= 0) throw new DailyLimitError();
    config = { ...config, maxRequests: Math.min(config.maxRequests, remaining) };
    claude = deps.claude ?? createClaudeAnalyzer(config);
  }

  const limits = config ?? { maxRequests: 0, maxCandidatesPerRequest: 0, maxContextChars: 0, contextLines: 0, maxOutputTokens: 0, maxBudgetUsd: 0, concurrency: 1, pricing: null };
  const run = async () => {
    if (input.mode === "diff") {
      const { sources, skipped } = sourcesFromDiff(input.diff);
      return runHybridReview({ sources, skipped, focus, analysis, jev, claude, limits });
    }
    return runHybridReview({ sources: [sourceFromCode(input.filename, input.code)], focus, analysis, jev, claude, limits });
  };
  const result = await run();
  if (result.claude.usage) dailyClaude.record(result.claude.usage.requests_attempted);
  return result;
}

export function safeError(e: unknown): { status: number; message: string } {
  if (e instanceof DailyLimitError) return { status: 429, message: e.message };
  if (e instanceof ClaudeError) {
    const status = e.kind === "config" ? 503 : e.kind === "rate_limited" ? 429 : e.kind === "invalid_request" ? 422 : 502;
    const extra = e.outcomeUncertain ? " The request may still have been processed; do not resubmit until you have checked usage." : "";
    return { status, message: e.message + extra };
  }
  if (e instanceof JevError) {
    const status = e.kind === "rate_limited" ? 429 : e.kind === "invalid_request" ? 422 : e.kind === "config" ? 503 : 502;
    const extra = e.outcomeUncertain ? " The request may still have been processed; do not resubmit until you have checked usage." : "";
    return { status, message: e.message + extra };
  }
  return { status: 500, message: "Review failed." };
}
