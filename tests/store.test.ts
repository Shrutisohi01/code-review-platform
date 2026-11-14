import { beforeEach, describe, expect, it, vi } from "vitest";

const review = { findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() };
const findingState = { upsert: vi.fn(), deleteMany: vi.fn() };
vi.mock("@/lib/db", () => ({ db: () => ({ review, findingState }) }));

const { deleteReview, getReview, listReviews, saveReview, setFindingStatus } = await import("@/lib/reviews/store");

beforeEach(() => vi.clearAllMocks());

describe("review store ownership", () => {
  it("scopes every read and delete to the owner's user id", async () => {
    review.findMany.mockResolvedValue([]);
    review.findFirst.mockResolvedValue(null);
    review.deleteMany.mockResolvedValue({ count: 0 });

    await listReviews("u1", { q: "app" });
    expect(review.findMany.mock.calls[0]![0].where).toMatchObject({ userId: "u1" });

    expect(await getReview("u1", "r1")).toBeNull();
    expect(review.findFirst.mock.calls[0]![0].where).toEqual({ id: "r1", userId: "u1" });

    expect(await deleteReview("u1", "r1")).toBe(false);
    expect(review.deleteMany.mock.calls[0]![0].where).toEqual({ id: "r1", userId: "u1" });
  });

  it("refuses to change finding state on a review the caller does not own", async () => {
    review.findFirst.mockResolvedValue(null);
    expect(await setFindingStatus("intruder", "r1", "f1", "RESOLVED")).toBe(false);
    expect(findingState.upsert).not.toHaveBeenCalled();
    expect(findingState.deleteMany).not.toHaveBeenCalled();
  });

  it("saves and clears finding state for the owner", async () => {
    review.findFirst.mockResolvedValue({ id: "r1" });
    expect(await setFindingStatus("u1", "r1", "f1", "IGNORED")).toBe(true);
    expect(findingState.upsert).toHaveBeenCalledOnce();
    expect(await setFindingStatus("u1", "r1", "f1", null)).toBe(true);
    expect(findingState.deleteMany).toHaveBeenCalledWith({ where: { reviewId: "r1", findingId: "f1" } });
  });

  it("stores the review under the caller's id with the submitted code", async () => {
    review.create.mockResolvedValue({ id: "new" });
    const result = { status: "complete", provider: "jev", overall_assessment: null, findings: [] } as never;
    const id = await saveReview("u1", { mode: "paste", filename: "a.ts", code: "x=1", focus: "general", analysis: "jev_only" }, result);
    expect(id).toBe("new");
    expect(review.create.mock.calls[0]![0].data).toMatchObject({ userId: "u1", filename: "a.ts", source: "x=1", inputBytes: 3 });
  });
});
