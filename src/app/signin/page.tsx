import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-sm opacity-80">Sign in with GitHub to run reviews and keep your history. Only your name, email and avatar are requested.</p>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="w-full rounded-md border px-4 py-2 text-sm font-medium">
          Continue with GitHub
        </button>
      </form>
    </main>
  );
}
