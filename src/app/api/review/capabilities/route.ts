import { NextResponse } from "next/server";
import { claudeAvailability } from "@/lib/claude";

/** Secret-free configuration summary so the UI can offer only the modes that can run. */
export async function GET() {
  const a = claudeAvailability();
  return NextResponse.json({
    jevConfigured: !!process.env.JEV_AI_API_KEY?.trim(),
    claude: a.available ? { available: true, model: process.env.ANTHROPIC_MODEL?.trim() ?? null } : { available: false, reason: a.reason },
  });
}
