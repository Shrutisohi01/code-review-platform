import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { saveReview } from "@/lib/reviews/store";
import { rateLimited } from "@/lib/security/limits";
import { Deduper, deduper } from "@/lib/review/dedupe";
import { performReview, safeError } from "@/lib/review/service";
import { reviewInput } from "@/lib/validation/review-input";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to run reviews." }, { status: 401 });
  const principal = `user:${user.id}`;

  if (rateLimited(principal, 10)) return NextResponse.json({ error: "Too many reviews. Try again in a minute." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = reviewInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 422 });
  }
  if (parsed.data.analysis === "thorough" && rateLimited(`${principal}:thorough`, 3)) {
    return NextResponse.json({ error: "Too many thorough reviews. Try again in a minute." }, { status: 429 });
  }
  try {
    const key = Deduper.key(principal, parsed.data);
    const result = await deduper.run(key, async () => {
      const r = await performReview(parsed.data);
      // Persist once per real run; replayed (cached) results already carry the id.
      return { ...r, review_id: await saveReview(user.id, parsed.data, r).catch(() => null) };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("No unified diff")) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    const { status, message } = safeError(e);
    return NextResponse.json({ error: message }, { status });
  }
}
