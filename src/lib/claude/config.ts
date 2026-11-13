import { ClaudeConfigError } from "./errors";

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  /** Output effort level; null = API default. */
  effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  timeoutMs: number;
  /** Hard cap on Claude requests for one review. */
  maxRequests: number;
  maxCandidatesPerRequest: number;
  /** Maximum characters of (redacted) source sent in one request. */
  maxContextChars: number;
  /** Lines of surrounding code added around each flagged region. */
  contextLines: number;
  maxOutputTokens: number;
  maxBudgetUsd: number;
  concurrency: number;
  pricing: Pricing | null;
}

export type ClaudeAvailability = { available: true } | { available: false; reason: "disabled" | "missing_key" | "missing_model" };

const OFF = new Set(["false", "0", "off", "no", "disabled"]);

/** Cheap, secret-free check used by the UI and the route before any Claude work is attempted. */
export function claudeAvailability(env: Record<string, string | undefined> = process.env): ClaudeAvailability {
  if (OFF.has((env.CLAUDE_ANALYSIS_ENABLED ?? "").trim().toLowerCase())) return { available: false, reason: "disabled" };
  if (!env.ANTHROPIC_API_KEY?.trim()) return { available: false, reason: "missing_key" };
  if (!env.ANTHROPIC_MODEL?.trim()) return { available: false, reason: "missing_model" };
  return { available: true };
}

export function unavailableMessage(reason: Exclude<ClaudeAvailability, { available: true }>["reason"]): string {
  switch (reason) {
    case "disabled":
      return "Claude analysis is disabled on this server (CLAUDE_ANALYSIS_ENABLED).";
    case "missing_key":
      return "Claude analysis is not configured: ANTHROPIC_API_KEY is not set on the server.";
    case "missing_model":
      return "Claude analysis is not configured: ANTHROPIC_MODEL is not set on the server.";
  }
}

/**
 * List prices in USD per million tokens as documented when this was written (2026-10-06).
 * They can go stale: set ANTHROPIC_INPUT_PRICE_PER_MTOK / ANTHROPIC_OUTPUT_PRICE_PER_MTOK to override.
 * Unknown models without overrides have no price, so cost is reported as unavailable.
 */
const KNOWN_PRICES: Record<string, Pricing> = {
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
};

function num(env: Record<string, string | undefined>, name: string, def: number, min: number, max: number, int = true): number {
  const raw = env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw new ClaudeConfigError(`${name} must be ${int ? "an integer" : "a number"} between ${min} and ${max}.`);
  }
  return n;
}

export function loadClaudeConfig(env: Record<string, string | undefined> = process.env): ClaudeConfig {
  const avail = claudeAvailability(env);
  if (!avail.available) throw new ClaudeConfigError(unavailableMessage(avail.reason));
  const model = env.ANTHROPIC_MODEL!.trim();

  const inP = env.ANTHROPIC_INPUT_PRICE_PER_MTOK?.trim();
  const outP = env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK?.trim();
  let pricing: Pricing | null = KNOWN_PRICES[model] ?? null;
  if (inP || outP) {
    const i = Number(inP);
    const o = Number(outP);
    if (!inP || !outP || !(i >= 0) || !(o >= 0) || !Number.isFinite(i) || !Number.isFinite(o)) {
      throw new ClaudeConfigError("Set both ANTHROPIC_INPUT_PRICE_PER_MTOK and ANTHROPIC_OUTPUT_PRICE_PER_MTOK to non-negative numbers.");
    }
    pricing = { inputPerMTok: i, outputPerMTok: o };
  }

  const effortRaw = (env.ANTHROPIC_EFFORT ?? "medium").trim().toLowerCase();
  const effort = effortRaw === "default" ? null : (effortRaw as ClaudeConfig["effort"]);
  if (effort !== null && !["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new ClaudeConfigError("ANTHROPIC_EFFORT must be low, medium, high, xhigh, max or default.");
  }

  const maxBudgetUsd = num(env, "CLAUDE_MAX_BUDGET_USD_PER_REVIEW", 0.25, 0.001, 100, false);
  // The budget is enforced from token prices; without a price it cannot be enforced, so refuse to run.
  if (!pricing) {
    throw new ClaudeConfigError(
      `No list price known for model "${model}". Set ANTHROPIC_INPUT_PRICE_PER_MTOK and ANTHROPIC_OUTPUT_PRICE_PER_MTOK so the per-review budget can be enforced.`,
    );
  }

  return {
    apiKey: env.ANTHROPIC_API_KEY!.trim(),
    model,
    effort,
    timeoutMs: num(env, "CLAUDE_TIMEOUT_MS", 60_000, 1_000, 300_000),
    maxRequests: num(env, "CLAUDE_MAX_REQUESTS_PER_REVIEW", 4, 1, 20),
    maxCandidatesPerRequest: num(env, "CLAUDE_MAX_CANDIDATES_PER_REQUEST", 8, 1, 32),
    maxContextChars: num(env, "CLAUDE_MAX_CONTEXT_CHARS", 40_000, 2_000, 400_000),
    contextLines: num(env, "CLAUDE_CONTEXT_LINES", 12, 0, 100),
    maxOutputTokens: num(env, "CLAUDE_MAX_OUTPUT_TOKENS", 6_000, 256, 32_000),
    maxBudgetUsd,
    concurrency: num(env, "CLAUDE_CONCURRENCY", 2, 1, 4),
    pricing,
  };
}
