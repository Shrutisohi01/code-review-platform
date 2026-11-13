import { JevConfigError } from "./errors";

export const JEV_BASE_URL = "https://jev-ai.pro/api";

export interface JevConfig {
  apiKey: string;
  baseUrl: typeof JEV_BASE_URL;
  model: string;
  timeoutMs: number;
}

/** Reads configuration from server env. The destination is pinned: any other base URL is rejected. */
export function loadJevConfig(env: Record<string, string | undefined> = process.env): JevConfig {
  const apiKey = env.JEV_AI_API_KEY?.trim();
  if (!apiKey) throw new JevConfigError("JEV_AI_API_KEY is not set on the server.");

  const rawBase = (env.JEV_API_BASE_URL?.trim() || JEV_BASE_URL).replace(/\/+$/, "");
  if (rawBase !== JEV_BASE_URL) {
    throw new JevConfigError(`JEV_API_BASE_URL must be exactly ${JEV_BASE_URL}.`);
  }

  const timeoutMs = Number(env.JEV_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new JevConfigError("JEV_TIMEOUT_MS must be between 1000 and 120000.");
  }

  return { apiKey, baseUrl: JEV_BASE_URL, model: env.JEV_MODEL_NAME?.trim() || "jev-latest", timeoutMs };
}
