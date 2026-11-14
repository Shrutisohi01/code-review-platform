import Link from "next/link";
import { redirect } from "next/navigation";
import { UserBar } from "@/components/user-bar";
import { currentUser } from "@/lib/auth";
import { listReviews } from "@/lib/reviews/store";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { q } = await searchParams;
  const reviews = await listReviews(user.id, { q });
  const stats = {
    total: reviews.length,
    flagged: reviews.reduce((n, r) => n + r.findingCount, 0),
    incomplete: reviews.filter((r) => r.status === "incomplete").length,
  };
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <UserBar user={user} />
      <h1 className="mb-1 text-xl font-semibold">History</h1>
      <p className="muted mb-4 text-sm">
        {stats.total} review{stats.total === 1 ? "" : "s"} shown · {stats.flagged} findings · {stats.incomplete} incomplete. Counts come from stored reviews only.
      </p>
      <form className="mb-4 flex gap-2" role="search">
        <input name="q" defaultValue={q ?? ""} placeholder="Search by file name" aria-label="Search by file name" className="panel flex-1 px-2 py-1.5 text-sm" />
        <button type="submit" className="panel px-3 py-1.5 text-sm">Search</button>
      </form>
      {reviews.length === 0 ? (
        <p className="panel p-6 text-center text-sm muted">{q ? "No reviews match that search." : "No reviews yet."}</p>
      ) : (
        <ul className="panel divide-y">
          {reviews.map((r) => (
            <li key={r.id}>
              <Link href={`/history/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                <span className="font-medium">{r.filename ?? "Git diff"}</span>
                <span className="muted">{r.createdAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span>
                <span className="muted">{r.analysis} · {r.focus} · {r.provider}</span>
                <span className="ml-auto">{r.findingCount} finding{r.findingCount === 1 ? "" : "s"}{r.status === "incomplete" ? " · incomplete" : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
