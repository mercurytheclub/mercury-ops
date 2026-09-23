import { auth } from "@/auth";
import { opsPersonForEmail } from "@/server/opsTeam";

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
 * Cross-origin note: the browser only sends the session cookie here if that cookie is
 * SameSite=None, which is a deliberate decision about this app's cookies, not something this
 * route can grant itself. Until it is made, this answers `{ name: null }` to the forms and the
 * dropdown falls back to the name remembered on the device. Nothing breaks either way.
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
    const person = await opsPersonForEmail(session?.user?.email);
    return Response.json({ name: person?.name ?? null, teams: person?.teams ?? [] }, { headers });
  } catch {
    // A roster read that fails must not take a form down with it.
    return Response.json({ name: null, teams: [] }, { headers });
  }
}
