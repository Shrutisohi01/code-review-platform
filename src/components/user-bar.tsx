import Link from "next/link";
import { signOut, type SessionUser } from "@/lib/auth";

export function UserBar({ user }: { user: SessionUser }) {
  return (
    <nav className="mb-4 flex items-center gap-4 text-sm" aria-label="Account">
      <Link href="/" className="font-medium">New review</Link>
      <Link href="/history">History</Link>
      <span className="ml-auto muted">{user.name ?? user.email}</span>
      <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
        <button type="submit" className="panel px-2 py-1">Sign out</button>
      </form>
    </nav>
  );
}
