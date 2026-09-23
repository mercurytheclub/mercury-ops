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

/**
 * Is this email approved for ops? (used by the sign-in gate)
 * Allowlist entries may be a full email (exact match) or a whole domain written
 * as "@example.com" (matches any address on that domain).
 */
export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  const at = e.indexOf("@");
  const domain = at >= 0 ? e.slice(at) : ""; // e.g. "@matthewassistants.com"
  return allowedEmails().some((entry) => (entry.startsWith("@") ? entry === domain : entry === e));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: "/login" },
  cookies: {
    // SameSite=None so the session travels to /api/ops-identity when an n8n ops form asks it
    // who is signed in. A Lax cookie is simply not sent on that request, which is why the
    // route could only ever answer "nobody" before this.
    //
    // What this widens, stated plainly: the browser now attaches this cookie to cross-site
    // requests to this app. Two things keep that from mattering. Reads are unreadable — no
    // route sends CORS headers except /api/ops-identity, and that one only to the origins in
    // OPS_IDENTITY_ORIGINS, so another site can cause a request but cannot see the answer.
    // Writes go through Next Server Actions, which reject a POST whose Origin does not match
    // the host. Neither is a reason to be careless with it.
    //
    // The name is pinned to the Auth.js default for secure cookies. Getting it wrong does not
    // error — it silently signs out everybody who is currently signed in.
    sessionToken: {
      name: "__Secure-authjs.session-token",
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true },
    },
  },
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
