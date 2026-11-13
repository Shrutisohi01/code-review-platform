import type { ClaudeUsage } from "./errors";
import type { Pricing } from "./config";

/** Conservative characters-per-token ratio used ONLY to reserve budget before a request. */
export const CHARS_PER_TOKEN_ESTIMATE = 2.5;

export function costUsd(usage: { input_tokens: number; output_tokens: number }, p: Pricing): number {
  return (usage.input_tokens * p.inputPerMTok + usage.output_tokens * p.outputPerMTok) / 1_000_000;
}

export interface UsageReport {
  requests_attempted: number;
  requests_completed: number;
  /** Sum over requests that reported usage; null when none did. */
  input_tokens: number | null;
  output_tokens: number | null;
  /** false when at least one attempted request has no usage numbers (totals are then lower bounds). */
  usage_complete: boolean;
  /** List-price estimate from reported tokens; NOT the billed amount. null = unavailable. */
  estimated_cost_usd: number | null;
  budget_usd: number;
  stopped_reason: "budget" | "request_limit" | "error" | "rate_limited" | "uncertain_outcome" | null;
}

/** Tracks spend and reserves worst-case cost before a request starts. */
export class UsageTracker {
  private attempted = 0;
  private completed = 0;
  private inTok = 0;
  private outTok = 0;
  private knownReqs = 0;
  private spent = 0; // USD: actual (from usage) or worst-case when usage is missing
  private reserved = 0;
  stopped: UsageReport["stopped_reason"] = null;

  constructor(
    private readonly pricing: Pricing,
    private readonly budgetUsd: number,
    private readonly maxRequests: number,
  ) {}

  worstCase(promptChars: number, maxOutputTokens: number): number {
    const inTok = Math.ceil(promptChars / CHARS_PER_TOKEN_ESTIMATE) + 200;
    return costUsd({ input_tokens: inTok, output_tokens: maxOutputTokens }, this.pricing);
  }

  /** Returns a reservation, or null (and records why) when the request must not start. */
  tryStart(worstCaseUsd: number): number | null {
    if (this.stopped) return null;
    if (this.attempted >= this.maxRequests) {
      this.stopped = "request_limit";
      return null;
    }
    if (this.spent + this.reserved + worstCaseUsd > this.budgetUsd) {
      this.stopped = "budget";
      return null;
    }
    this.attempted++;
    this.reserved += worstCaseUsd;
    return worstCaseUsd;
  }

  finish(reservation: number, usage: ClaudeUsage | null, ok: boolean) {
    this.reserved -= reservation;
    if (ok) this.completed++;
    if (usage && usage.input_tokens !== null && usage.output_tokens !== null) {
      this.knownReqs++;
      this.inTok += usage.input_tokens;
      this.outTok += usage.output_tokens;
      this.spent += costUsd({ input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }, this.pricing);
    } else {
      // Unknown usage: assume the worst case was spent so the budget stays conservative.
      this.spent += reservation;
    }
  }

  stop(reason: NonNullable<UsageReport["stopped_reason"]>) {
    this.stopped ??= reason;
  }

  report(): UsageReport {
    const complete = this.knownReqs === this.attempted;
    return {
      requests_attempted: this.attempted,
      requests_completed: this.completed,
      input_tokens: this.knownReqs ? this.inTok : null,
      output_tokens: this.knownReqs ? this.outTok : null,
      usage_complete: complete,
      estimated_cost_usd: this.knownReqs ? Number(costUsd({ input_tokens: this.inTok, output_tokens: this.outTok }, this.pricing).toFixed(6)) : null,
      budget_usd: this.budgetUsd,
      stopped_reason: this.stopped,
    };
  }
}
