import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Auth.js (v5). Google sign-in, restricted to an explicit email allowlist —
// only approved Mercury team members can get in. The provider auto-reads
// AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the environment.

function allowedEmails(): string[] {
  return (process.env.OPS_ALLOWED_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this email approved for ops? (used by the sign-in gate) */
export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: "/login" },
  callbacks: {
    // Gate the OAuth sign-in itself: reject anyone not on the allowlist.
    signIn({ profile }) {
      return isAllowed(profile?.email);
    },
    // Used by middleware. Until Google OAuth is actually configured
    // (AUTH_GOOGLE_ID set), don't lock the app — this prevents a lockout while
    // the credentials are being set up, and lets us flip enforcement on simply
    // by adding the env var. Once configured, every route requires a session.
    authorized({ auth }) {
      if (!process.env.AUTH_GOOGLE_ID) return true;
      return !!auth?.user;
    },
  },
});
