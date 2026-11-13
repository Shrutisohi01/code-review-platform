/**
 * In-memory limiters. They only see one server instance: behind several instances or serverless
 * functions each keeps its own counters, so use a shared store (e.g. Redis) before scaling out.
 */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return recent.length > max;
}

let day = "";
let used = 0;

function roll(now: Date) {
  const d = now.toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    used = 0;
  }
}

/** Daily cap on Claude requests for this instance (protects the Anthropic balance). */
export const dailyClaude = {
  remaining(cap: number, now = new Date()): number {
    roll(now);
    return Math.max(0, cap - used);
  },
  record(n: number, now = new Date()) {
    roll(now);
    used += n;
  },
  reset() {
    day = "";
    used = 0;
  },
};

export function resetRateLimits() {
  hits.clear();
}
