export type JevErrorKind =
  | "config"
  | "auth"
  | "insufficient_balance"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "outcome_unknown"
  | "malformed_response";

export class JevError extends Error {
  constructor(
    public readonly kind: JevErrorKind,
    /** Safe to show in UI: never contains secrets or submitted code. */
    message: string,
    public readonly status?: number,
    /** True only when the docs establish that re-sending is safe/appropriate after a wait. */
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
  /** A decision request may have been executed and billed; verify usage before re-sending. */
  get outcomeUncertain() {
    return this.kind === "outcome_unknown";
  }
}

export class JevConfigError extends JevError {
  constructor(message: string) {
    super("config", message);
    this.name = "JevConfigError";
  }
}

/** Maps documented HTTP statuses (jev-ai.pro/docs#errors) to errors. */
export function errorFromStatus(status: number, retryAfterMs?: number): JevError {
  switch (status) {
    case 400:
    case 422:
      return new JevError("invalid_request", "JEV rejected the request as invalid.", status);
    case 401:
      return new JevError("auth", "JEV authentication failed. Check the server API key.", status);
    case 402:
      return new JevError("insufficient_balance", "JEV balance is insufficient or spending is paused.", status);
    case 404:
      return new JevError("not_found", "JEV endpoint or resource not found.", status);
    case 409:
      return new JevError("conflict", "JEV resource revision conflict.", status);
    case 429:
      return new JevError("rate_limited", "JEV rate limit reached. Try again shortly.", status, true, retryAfterMs);
    case 502:
    case 503:
      return new JevError("upstream_unavailable", "JEV model is temporarily unavailable.", status, true, retryAfterMs);
    case 504:
      return new JevError("outcome_unknown", "JEV timed out upstream; the request outcome is unknown.", status);
    default:
      return new JevError("upstream_unavailable", `Unexpected JEV response (HTTP ${status}).`, status);
  }
}
