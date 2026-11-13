import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ClaudeConfig } from "./config";
import { ClaudeError, ClaudeUsage } from "./errors";
import { AnalysisOutput, analysisOutput } from "./schema";

export interface ClaudeAnalysisRequest {
  system: string;
  user: string;
}

export interface ClaudeAnalysisResponse {
  output: AnalysisOutput;
  usage: ClaudeUsage;
}

/** Provider boundary used by the review pipeline. */
export interface ClaudeAnalyzer {
  readonly model: string;
  analyze(req: ClaudeAnalysisRequest): Promise<ClaudeAnalysisResponse>;
}

/** The slice of the SDK we use, so tests can inject a fake. */
export interface MessagesApi {
  messages: { create(params: any): Promise<Anthropic.Message> };
}

const FORMAT = zodOutputFormat(analysisOutput);

function usageOf(m: Anthropic.Message): ClaudeUsage {
  const u = m.usage;
  return {
    input_tokens: typeof u?.input_tokens === "number" ? u.input_tokens : null,
    output_tokens: typeof u?.output_tokens === "number" ? u.output_tokens : null,
  };
}

function mapSdkError(e: unknown): ClaudeError {
  // Exception messages can echo request details; only fixed, safe text is surfaced.
  if (e instanceof ClaudeError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ClaudeError("outcome_unknown", "Claude request timed out; the outcome is unknown and it may have been billed.");
  if (e instanceof Anthropic.APIConnectionError) return new ClaudeError("outcome_unknown", "Connection to Claude failed; the outcome is unknown and it may have been billed.");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ClaudeError("auth", "Claude authentication failed. Check the server API key.");
  if (e instanceof Anthropic.RateLimitError) return new ClaudeError("rate_limited", "Claude rate limit reached. Try again shortly.");
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new ClaudeError("invalid_request", "Claude rejected the request (check ANTHROPIC_MODEL and limits).");
  }
  if (e instanceof Anthropic.APIError) return new ClaudeError("upstream_unavailable", "Claude is temporarily unavailable.");
  return new ClaudeError("upstream_unavailable", "Claude request failed.");
}

export function createClaudeAnalyzer(config: ClaudeConfig, sdk?: MessagesApi): ClaudeAnalyzer {
  // maxRetries: 0 — a retried request after a timeout could be billed twice; the pipeline decides what to do.
  const api: MessagesApi = sdk ?? (new Anthropic({ apiKey: config.apiKey, maxRetries: 0, timeout: config.timeoutMs }) as unknown as MessagesApi);
  return {
    model: config.model,
    async analyze(req) {
      let msg: Anthropic.Message;
      try {
        msg = await api.messages.create({
          model: config.model,
          max_tokens: config.maxOutputTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: { format: FORMAT, ...(config.effort ? { effort: config.effort } : {}) },
        });
      } catch (e) {
        throw mapSdkError(e);
      }
      const usage = usageOf(msg);
      if (msg.stop_reason === "refusal") throw new ClaudeError("refusal", "Claude declined to analyze this content.", usage);
      if (msg.stop_reason === "max_tokens") throw new ClaudeError("truncated", "Claude's answer hit the output-token limit and was discarded.", usage);
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ClaudeError("malformed_response", "Claude returned a response that is not valid JSON.", usage);
      }
      const parsed = analysisOutput.safeParse(json);
      if (!parsed.success) throw new ClaudeError("malformed_response", "Claude's response did not match the expected schema.", usage);
      return { output: parsed.data, usage };
    },
  };
}
