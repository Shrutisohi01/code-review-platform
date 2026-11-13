import { NextResponse } from "next/server";
import { JevClient, JevError, loadJevConfig } from "@/lib/jev";

/** Model-list check only (no inference). Never returns credentials. */
export async function GET() {
  try {
    const cfg = loadJevConfig();
    const ok = await new JevClient(cfg).isModelAvailable();
    return NextResponse.json({ destination: cfg.baseUrl, model: cfg.model, modelAvailable: ok });
  } catch (e) {
    const message = e instanceof JevError ? e.message : "Health check failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
