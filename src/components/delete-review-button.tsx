"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteReviewButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!window.confirm("Delete this review and its stored code permanently? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/history/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) router.push("/history");
    else { setBusy(false); setError("Could not delete the review."); }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
      <button type="button" onClick={onDelete} disabled={busy} className="panel px-3 py-1.5 text-sm text-red-500">Delete review</button>
    </span>
  );
}
