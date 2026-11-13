import { createHash } from "node:crypto";
import type { ReviewResult } from "./types";

interface Entry {
  at: number;
  result?: ReviewResult;
  error?: unknown;
}

/**
 * Stops accidental repeated billable calls: identical submissions from one principal share one
 * in-flight run, and a finished run (or an uncertain failure) is replayed for a short TTL instead of
 * calling the providers again. Memory only and per instance; results are held in memory for the TTL.
 */
export class Deduper {
  private inflight = new Map<string, Promise<ReviewResult>>();
  private done = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 600_000,
    private readonly errorTtlMs = 60_000,
    private readonly maxEntries = 200,
  ) {}

  static key(principal: string, payload: unknown): string {
    return createHash("sha256").update(principal).update("\0").update(JSON.stringify(payload)).digest("hex");
  }

  async run(key: string, fn: () => Promise<ReviewResult>, now = Date.now()): Promise<ReviewResult> {
    const hit = this.done.get(key);
    if (hit) {
      if (now - hit.at < (hit.error ? this.errorTtlMs : this.ttlMs)) {
        if (hit.error) throw hit.error;
        return { ...hit.result!, cached: true };
      }
      this.done.delete(key);
    }
    const running = this.inflight.get(key);
    if (running) return { ...(await running), cached: true };

    const p = fn();
    this.inflight.set(key, p);
    try {
      const result = await p;
      this.remember(key, { at: now, result });
      return result;
    } catch (e) {
      // Only an uncertain outcome (request may have been billed) blocks an immediate resubmission.
      if ((e as { outcomeUncertain?: boolean })?.outcomeUncertain) this.remember(key, { at: now, error: e });
      throw e;
    } finally {
      this.inflight.delete(key);
    }
  }

  private remember(key: string, e: Entry) {
    this.done.set(key, e);
    if (this.done.size > this.maxEntries) this.done.delete(this.done.keys().next().value!);
  }

  clear() {
    this.inflight.clear();
    this.done.clear();
  }
}

export const deduper = new Deduper(Number(process.env.REVIEW_DEDUPE_TTL_SEC ?? 600) * 1000);
