import { NextResponse } from "next/server";
import { authorize } from "@/lib/security/access";
import { rateLimited } from "@/lib/security/limits";
import { Deduper, deduper } from "@/lib/review/dedupe";
import { performReview, safeError } from "@/lib/review/service";
import { reviewInput } from "@/lib/validation/review-input";

export async function POST(req: Request) {
  const access = authorize(req);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  if (rateLimited(access.principal, 10)) return NextResponse.json({ error: "Too many reviews. Try again in a minute." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = reviewInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 422 });
  }
  if (parsed.data.analysis === "thorough" && rateLimited(`${access.principal}:thorough`, 3)) {
    return NextResponse.json({ error: "Too many thorough reviews. Try again in a minute." }, { status: 429 });
  }
  try {
    const key = Deduper.key(access.principal, parsed.data);
    return NextResponse.json(await deduper.run(key, () => performReview(parsed.data)));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("No unified diff")) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    const { status, message } = safeError(e);
    return NextResponse.json({ error: message }, { status });
  }
}
