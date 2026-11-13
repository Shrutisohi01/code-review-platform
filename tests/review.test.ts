import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/review/diff";
import { sourceFromCode, sourcesFromDiff } from "@/lib/review/sources";
import { DecisionProvider, mockProvider, regionsFor, runReview } from "@/lib/review/engine";
import { reviewInput } from "@/lib/validation/review-input";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ function f() {
 const a = 1;
-const b = 2;
+const b = 3;
+eval(input);
 return a;
`;

describe("diff parsing", () => {
  it("maps added lines to new-file numbers", () => {
    const [f] = parseUnifiedDiff(DIFF);
    expect(f!.newPath).toBe("src/a.ts");
    const adds = f!.hunks[0]!.lines.filter((l) => l.type === "add").map((l) => l.newLine);
    expect(adds).toEqual([11, 12]);
    expect(f!.hunks[0]!.lines.find((l) => l.type === "del")!.oldLine).toBe(11);
  });
  it("rejects non-diffs", () => expect(() => parseUnifiedDiff("hello")).toThrow());
  it("skips binary files and deletions", () => {
    const d = "diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n";
    expect(sourcesFromDiff(d).skipped).toEqual(["x.png"]);
  });
});

describe("regions", () => {
  it("diff regions start only at changed lines", () => {
    const { sources } = sourcesFromDiff(DIFF);
    const r = regionsFor(sources[0]!);
    expect(r).toHaveLength(1);
    expect(r[0]!.start).toBeLessThanOrEqual(11);
  });
});

describe("engine", () => {
  const code = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join("\n");
  it("normalizes flagged regions to exact lines, validated by zod", async () => {
    const p: DecisionProvider = {
      name: "jev",
      async decide(req) {
        return { response: { model: "m", answers: Object.fromEntries(Object.entries(req.questions).map(([id]) => [id, id === "r1_bug"
          ? { type: "choice" as const, choice: "high", probabilities: { none: 0.1, high: 0.9 }, confidence: 0.9 }
          : { type: "choice" as const, choice: "none", probabilities: { none: 0.99, high: 0.01 }, confidence: 0.99 }])) } };
      },
    };
    const r = await runReview([sourceFromCode("a.ts", code)], "general", p);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ category: "bug", severity: "high", start_line: 21, end_line: 40, suggested_code: null });
    expect(r.overall_assessment).toBe("needs_attention");
  });
  it("never reports pass for the mock provider", async () => {
    const r = await runReview([sourceFromCode("a.ts", "x")], "general", mockProvider);
    expect(r.overall_assessment).toBeNull();
  });
  it("marks over-limit files incomplete instead of passing", async () => {
    const big = Array.from({ length: 1000 }, () => "x").join("\n");
    const r = await runReview([sourceFromCode("a.ts", big)], "general", { ...mockProvider, name: "jev" });
    expect(r.status).toBe("incomplete");
    expect(r.overall_assessment).toBeNull();
  });
  it("flags diff findings only inside changed regions", async () => {
    const { sources } = sourcesFromDiff(DIFF);
    const r = await runReview(sources, "security", mockProvider);
    expect(r.findings.every((f) => f.start_line >= 11)).toBe(true);
    expect(r.findings[0]?.start_line).toBe(11);
  });
});

describe("input validation", () => {
  it("rejects bad extensions, binary and oversize input", () => {
    const base = { mode: "paste", code: "x", focus: "general" };
    expect(reviewInput.safeParse({ ...base, filename: "a.exe" }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, filename: "a.ts", code: "a\0b" }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, filename: "a.ts", code: "x".repeat(100_001) }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, filename: "a.ts" }).success).toBe(true);
  });
});
