export type ClaudeErrorKind =
  | "config"
  | "auth"
  | "rate_limited"
  | "upstream_unavailable"
  | "invalid_request"
  | "outcome_unknown"
  | "refusal"
  | "truncated"
  | "malformed_response";

export interface ClaudeUsage {
  input_tokens: number | null;
  output_tokens: number | null;
}

export class ClaudeError extends Error {
  constructor(
    public readonly kind: ClaudeErrorKind,
    /** Safe to show in UI: never contains secrets, submitted code or provider response text. */
    message: string,
    /** Usage reported by the API for this request, when a response was received. */
    public readonly usage: ClaudeUsage | null = null,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
  /** The request may have been executed and billed even though no response was received. */
  get outcomeUncertain() {
    return this.kind === "outcome_unknown";
  }
}

export class ClaudeConfigError extends ClaudeError {
  constructor(message: string) {
    super("config", message);
    this.name = "ClaudeConfigError";
  }
}
