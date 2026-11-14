import { notFound, redirect } from "next/navigation";
import { DeleteReviewButton } from "@/components/delete-review-button";
import { ResultView } from "@/components/result-view";
import { UserBar } from "@/components/user-bar";
import { currentUser } from "@/lib/auth";
import { getReview } from "@/lib/reviews/store";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const review = await getReview(user.id, (await params).id);
  if (!review) notFound();
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <UserBar user={user} />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Saved review</h1>
        <span className="muted text-sm">{review.createdAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span>
        <span className="ml-auto"><DeleteReviewButton id={review.id} /></span>
      </div>
      <ResultView result={review.result} initialStates={review.states} />
    </main>
  );
}
