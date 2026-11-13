import { JevConfig } from "./config";
import { JevError, errorFromStatus } from "./errors";
import {
  DecisionRequest,
  DecisionResponse,
  ModelsResponse,
  decisionResponse,
  modelsResponse,
  validateDecisionRequest,
} from "./schemas";

export interface BillingInfo {
  runId?: string;
  creditsCharged?: string;
  creditsRemaining?: string;
  tokensRemaining?: string;
}

export interface DecisionResult {
  response: DecisionResponse;
  billing: BillingInfo;
}

type Fetch = typeof fetch;
const MAX_MODEL_LIST_RETRIES = 2;
const MAX_BACKOFF_MS = 5_000;

function parseRetryAfter(h: string | null): number | undefined {
  const s = h ? Number(h) : NaN;
  return Number.isFinite(s) ? Math.min(s * 1000, MAX_BACKOFF_MS) : undefined;
}

export class JevClient {
  constructor(
    private readonly config: JevConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async send(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
    try {
      return await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      // Never include the underlying error: it may echo request details.
      throw new JevError("outcome_unknown", "No response from JEV (timeout or connection loss).");
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /v1/models. No inference, so bounded retries on 429/502/503 are safe. */
  async listModels(): Promise<ModelsResponse> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.send("/v1/models", { method: "GET" });
      } catch (e) {
        if (attempt < MAX_MODEL_LIST_RETRIES) continue;
        throw e;
      }
      if (!res.ok) {
        const err = errorFromStatus(res.status, parseRetryAfter(res.headers.get("retry-after")));
        if (err.retryable && attempt < MAX_MODEL_LIST_RETRIES) {
          await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      const parsed = modelsResponse.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new JevError("malformed_response", "JEV model list had an unexpected shape.");
      return parsed.data;
    }
  }

  async isModelAvailable(name = this.config.model): Promise<boolean> {
    return (await this.listModels()).models.some((m) => m.name === name);
  }

  /** POST /v1/systemone. Exactly one attempt: never retried automatically (billable, maxRetries: 0 per docs). */
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const body = validateDecisionRequest({ model: this.config.model, ...request });
    const res = await this.send("/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw errorFromStatus(res.status, parseRetryAfter(res.headers.get("retry-after")));

    // A 200 was received, so the run happened; a bad body is malformed, not a retry candidate.
    const parsed = decisionResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new JevError("malformed_response", "JEV decision response had an unexpected shape.");
    for (const id of Object.keys(body.questions)) {
      if (!parsed.data.answers[id]) throw new JevError("malformed_response", "JEV response is missing an answer.");
      if (parsed.data.answers[id].type !== body.questions[id]!.type) {
        throw new JevError("malformed_response", "JEV answer type does not match the question.");
      }
    }
    const h = res.headers;
    return {
      response: parsed.data,
      billing: {
        runId: h.get("x-jev-run-id") ?? undefined,
        creditsCharged: h.get("x-jev-credits-charged") ?? undefined,
        creditsRemaining: h.get("x-jev-credits-remaining") ?? undefined,
        tokensRemaining: h.get("x-jev-tokens-remaining") ?? undefined,
      },
    };
  }
}
