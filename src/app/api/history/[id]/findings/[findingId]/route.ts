import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { setFindingStatus } from "@/lib/reviews/store";

const body = z.object({ status: z.enum(["RESOLVED", "IGNORED"]).nullable() });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; findingId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid status." }, { status: 422 });
  const { id, findingId } = await params;
  if (findingId.length > 128) return NextResponse.json({ error: "Invalid finding id." }, { status: 422 });
  const ok = await setFindingStatus(user.id, id, findingId, parsed.data.status);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Review not found." }, { status: 404 });
}
