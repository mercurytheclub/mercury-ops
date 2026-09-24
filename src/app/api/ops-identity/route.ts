import { auth } from "@/auth";
import { opsPersonForSession } from "@/server/opsTeam";

/**
 * Who is signed in, by the name the ops forms use.
 *
 * The n8n forms call this from their own origin so a person who is already signed in here does
 * not have to pick their own name out of a list on every form. It answers with a name or with
 * nothing; it is a convenience, never a permission. Nothing downstream may treat a name from
 * here as proof of anything — the forms themselves are the security boundary, not this.
 *
 * Returns `{ name: null }` rather than a 401 when nobody is signed in, because the caller is a
 * form that should quietly carry on letting the person pick by hand.
 *
 * Cross-origin: the session cookie is SameSite=None so the browser sends it here (see auth.ts).
 * A browser that blocks third-party cookies — Safari does by default — sends nothing regardless,
 * and this answers `{ name: null }`; the form then falls back to the name remembered on the
 * device, exactly as it did before. Nothing breaks either way.
 */

const ALLOWED_ORIGINS = new Set(
  (process.env.OPS_IDENTITY_ORIGINS ?? "https://matthewbecker.app.n8n.cloud")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function cors(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...cors(req.headers.get("origin")), "Access-Control-Max-Age": "86400" },
  });
}

export async function GET(req: Request) {
  const headers = {
    ...cors(req.headers.get("origin")),
    "Cache-Control": "no-store, private",
  };
  try {
    const session = await auth();
    const person = await opsPersonForSession(session?.user);
    if (person) {
      return Response.json({ name: person.name, teams: person.teams, reason: "matched" }, { headers });
    }
    /* Say WHY there is no name, because the three reasons are indistinguishable from the form's
     * side and all of them look like "the feature is broken".
     *
     * When somebody IS signed in and still does not match, echo back the account we saw. It is
     * their own address going to their own browser — the thing kept off these pages is OTHER
     * people's, which is why the roster endpoint still returns names only. Without it, working
     * out why a form will not fill itself in means guessing at which Google account someone used.
     */
    if (!session?.user) {
      return Response.json({ name: null, teams: [], reason: "not-signed-in" }, { headers });
    }
    return Response.json({
      name: null, teams: [], reason: "signed-in-but-not-on-the-roster",
      signedInAs: session.user.email ?? null,
      googleName: session.user.name ?? null,
      hint: "Add this address to Email on the 🧑 Ops Team row for this person, or make their "
          + "Google display name start with the name the roster uses.",
    }, { headers });
  } catch (e) {
    // A roster read that fails must not take a form down with it — but it must not look like
    // "you are not on the roster" either, or somebody goes and edits Airtable for no reason.
    return Response.json({
      name: null, teams: [], reason: "roster-unavailable",
      detail: e instanceof Error ? e.message.slice(0, 200) : null,
    }, { headers });
  }
}
