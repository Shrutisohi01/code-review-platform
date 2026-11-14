import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteReview, getReview } from "@/lib/reviews/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const review = await getReview(user.id, (await params).id);
  // Same response for "missing" and "someone else's": no information about other users' ids.
  return review ? NextResponse.json(review) : NextResponse.json({ error: "Review not found." }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const ok = await deleteReview(user.id, (await params).id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Review not found." }, { status: 404 });
}
