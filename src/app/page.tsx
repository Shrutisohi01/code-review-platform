import { ReviewApp } from "@/components/review-app";

export default function Page() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Code review</h1>
        <p className="muted text-sm">
          Submitted code is sent to the JEV API for analysis and, when Claude analysis is enabled, also to Anthropic for processing. This app does not store it; check each provider's terms for their own handling. Findings are model outputs; verify each one.
        </p>
      </header>
      <ReviewApp />
    </main>
  );
}
