import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listReviews } from "@/lib/reviews/store";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return NextResponse.json({ reviews: await listReviews(user.id, { q }) });
}
