import { describe, expect, it, vi } from "vitest";
import { JevClient, JevError, loadJevConfig, validateDecisionRequest } from "../src/lib/jev";

const env = { JEV_AI_API_KEY: "test-key" };
const cfg = () => loadJevConfig(env);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const req = { state: "x", questions: { q: { type: "noul" as const, instructions: "?" } } };
const okBody = { model: "jev-1", answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } };

describe("config", () => {
  it("requires key and pins destination", () => {
    expect(() => loadJevConfig({})).toThrow(/not set/);
    expect(() => loadJevConfig({ ...env, JEV_API_BASE_URL: "https://evil.example/api" })).toThrow(/exactly/);
    expect(loadJevConfig({ ...env, JEV_API_BASE_URL: "https://jev-ai.pro/api/" }).baseUrl).toBe("https://jev-ai.pro/api");
  });
});

describe("client", () => {
  it("sends bearer auth to the pinned URL and parses models", async () => {
    const f = vi.fn(async () => json({ models: [{ name: "jev-latest" }] }));
    const c = new JevClient(cfg(), f as unknown as typeof fetch);
    expect(await c.isModelAvailable()).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://jev-ai.pro/api/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("builds a decision request with the model and parses billing headers", async () => {
    const f = vi.fn(async () => json(okBody, 200, { "x-jev-run-id": "r1" }));
    const r = await new JevClient(cfg(), f as unknown as typeof fetch).decide(req);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://jev-ai.pro/api/v1/systemone");
    expect(JSON.parse(init.body as string).model).toBe("jev-latest");
    expect(r.billing.runId).toBe("r1");
  });

  it.each([
    [401, "auth"], [402, "insufficient_balance"], [422, "invalid_request"], [429, "rate_limited"], [504, "outcome_unknown"],
  ])("maps %i to %s and never retries a decision", async (status, kind) => {
    const f = vi.fn(async () => json({ error: { code: status, message: "x" } }, status));
    await expect(new JevClient(cfg(), f as unknown as typeof fetch).decide(req)).rejects.toMatchObject({ kind });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("treats a network failure as an uncertain outcome without retry", async () => {
    const f = vi.fn(async () => { throw new Error("secret-bearing detail"); });
    const p = new JevClient(cfg(), f as unknown as typeof fetch).decide(req);
    await expect(p).rejects.toMatchObject({ kind: "outcome_unknown", message: expect.not.stringContaining("secret") });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or mismatched responses", async () => {
    for (const body of [{ nope: 1 }, { model: "m", answers: {} }, { model: "m", answers: { q: { type: "choice", choice: "a", probabilities: {}, confidence: 1 } } }]) {
      const f = vi.fn(async () => json(body));
      await expect(new JevClient(cfg(), f as unknown as typeof fetch).decide(req)).rejects.toMatchObject({ kind: "malformed_response" });
    }
  });

  it("retries the model list only a bounded number of times", async () => {
    const f = vi.fn(async () => json({}, 503, { "retry-after": "0" }));
    await expect(new JevClient(cfg(), f as unknown as typeof fetch).listModels()).rejects.toBeInstanceOf(JevError);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("request validation", () => {
  it("enforces question limits and body size", () => {
    expect(() => validateDecisionRequest({ state: "x", questions: {} })).toThrow();
    expect(() => validateDecisionRequest({ state: "x", questions: { q: { type: "choice", instructions: "?", criteria: { a: null } } } })).toThrow();
    expect(() => validateDecisionRequest({ state: "x".repeat(300_000), questions: req.questions })).toThrow(/bytes/);
  });
});
