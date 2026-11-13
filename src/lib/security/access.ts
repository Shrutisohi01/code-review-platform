import { createHash, timingSafeEqual } from "node:crypto";

export type AccessDecision = { ok: true; principal: string } | { ok: false; status: number; message: string };

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * Smallest viable access control: a shared secret (REVIEW_ACCESS_TOKEN) sent as a Bearer token.
 * This is NOT per-user authentication. In production the API refuses to run without it unless
 * ALLOW_UNAUTHENTICATED=true is set explicitly.
 */
export function authorize(req: Request, env: Record<string, string | undefined> = process.env): AccessDecision {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const expected = env.REVIEW_ACCESS_TOKEN?.trim();
  if (!expected) {
    if (env.NODE_ENV === "production" && env.ALLOW_UNAUTHENTICATED !== "true") {
      return { ok: false, status: 503, message: "Access control is not configured on this server (REVIEW_ACCESS_TOKEN). The review API is disabled until it is set." };
    }
    return { ok: true, principal: `ip:${ip}` };
  }
  const header = req.headers.get("authorization");
  const given = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : req.headers.get("x-access-token")?.trim() ?? "";
  if (!given || !timingSafeEqual(sha(given), sha(expected))) {
    return { ok: false, status: 401, message: "Access token missing or invalid." };
  }
  return { ok: true, principal: `token:${sha(expected).toString("hex").slice(0, 8)}:${ip}` };
}

export function accessRequired(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.REVIEW_ACCESS_TOKEN?.trim();
}
