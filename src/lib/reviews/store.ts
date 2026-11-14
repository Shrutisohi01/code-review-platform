import { db } from "@/lib/db";
import type { ReviewInput } from "@/lib/validation/review-input";
import { reviewResult, type ReviewResult } from "@/lib/review/types";

/**
 * Every function takes the owner's user id and filters on it, so a review can only be read,
 * changed or deleted by the user who created it. Callers must pass the id from the session.
 */

const sourceOf = (input: ReviewInput) => (input.mode === "diff" ? input.diff : input.code);

export async function saveReview(userId: string, input: ReviewInput, result: ReviewResult): Promise<string> {
  const source = sourceOf(input);
  const row = await db().review.create({
    data: {
      userId,
      mode: input.mode,
      analysis: input.analysis,
      focus: input.focus,
      filename: input.mode === "diff" ? null : input.filename,
      inputBytes: new TextEncoder().encode(source).length,
      source,
      status: result.status,
      provider: result.provider,
      assessment: result.overall_assessment,
      findingCount: result.findings.length,
      result: result as object,
    },
    select: { id: true },
  });
  return row.id;
}

export interface ReviewListItem {
  id: string;
  createdAt: Date;
  mode: string;
  analysis: string;
  focus: string;
  filename: string | null;
  status: string;
  provider: string;
  assessment: string | null;
  findingCount: number;
}

export async function listReviews(userId: string, opts: { q?: string; take?: number } = {}): Promise<ReviewListItem[]> {
  const q = opts.q?.trim();
  return db().review.findMany({
    where: { userId, ...(q ? { filename: { contains: q, mode: "insensitive" as const } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 50, 100),
    select: { id: true, createdAt: true, mode: true, analysis: true, focus: true, filename: true, status: true, provider: true, assessment: true, findingCount: true },
  });
}

export async function getReview(userId: string, id: string) {
  const row = await db().review.findFirst({ where: { id, userId }, include: { findings: true } });
  if (!row) return null;
  const parsed = reviewResult.safeParse(row.result);
  if (!parsed.success) return null;
  const states: Record<string, "RESOLVED" | "IGNORED"> = {};
  for (const f of row.findings) states[f.findingId] = f.status;
  return { id: row.id, createdAt: row.createdAt, result: { ...parsed.data, review_id: row.id }, states };
}

export async function deleteReview(userId: string, id: string): Promise<boolean> {
  const { count } = await db().review.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** status null clears the state. Returns false when the review is not the caller's. */
export async function setFindingStatus(userId: string, reviewId: string, findingId: string, status: "RESOLVED" | "IGNORED" | null): Promise<boolean> {
  const owned = await db().review.findFirst({ where: { id: reviewId, userId }, select: { id: true } });
  if (!owned) return false;
  if (status === null) {
    await db().findingState.deleteMany({ where: { reviewId, findingId } });
  } else {
    await db().findingState.upsert({
      where: { reviewId_findingId: { reviewId, findingId } },
      create: { reviewId, findingId, status },
      update: { status },
    });
  }
  return true;
}
