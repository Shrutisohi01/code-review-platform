import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

/**
 * Auth.js with GitHub sign-in and database sessions. Reads AUTH_SECRET, AUTH_GITHUB_ID and
 * AUTH_GITHUB_SECRET from the environment. Only identity scopes are requested here; repository
 * access (phase 4) will use a separate GitHub App.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: PrismaAdapter(db()),
  providers: [GitHub],
  session: { strategy: "database" },
  pages: { signIn: "/signin" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
}));

export interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/** The signed-in user, or null. Always call this in the route/data layer, never rely on UI checks. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  return user?.id ? { id: user.id, name: user.name, email: user.email, image: user.image } : null;
}
