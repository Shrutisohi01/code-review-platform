import { redirect } from "next/navigation";
import { ReviewApp } from "@/components/review-app";
import { UserBar } from "@/components/user-bar";
import { currentUser } from "@/lib/auth";

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <UserBar user={user} />
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Code review</h1>
        <p className="muted text-sm">
          Submitted code is sent to the JEV API for analysis and, when Claude analysis is enabled, also to Anthropic for processing. Each review, including the submitted code, is saved to your history so you can reopen it; only you can see it and you can delete it at any time. Check each provider's terms for their own handling. Findings are model outputs; verify each one.
        </p>
      </header>
      <ReviewApp />
    </main>
  );
}
