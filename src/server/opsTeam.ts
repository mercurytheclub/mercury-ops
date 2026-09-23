import "server-only";
import { fetchAllPages, makeCached } from "@/server/airtable";

// The ops roster, read from 🧑 Ops Team. This exists so a signed-in person can be recognised by
// the n8n forms: they sign in with Google, we map that to the name the forms and cards have
// always used, and the form fills its own "who is doing this" field in.
//
// The email lives here and never goes to the browser. The forms are public URLs; the first names
// on them are not a secret, staff addresses are, and nothing on a form needs one — the only thing
// that crosses the wire is the matched name.

const OPS_TEAM_TABLE_ID = "tblkNYq2BnBcV7oqE"; // 🧑 Ops Team

type Row = { id: string; fields: Record<string, unknown> };

export type OpsPerson = { name: string; teams: string[] };

type Roster = { byEmail: Map<string, OpsPerson>; byFirstName: Map<string, OpsPerson[]> };

const firstName = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/** Active roster, indexed both ways. A row with no email simply cannot be matched by email. */
export const loadOpsRoster = makeCached(async (): Promise<Roster> => {
  const rows = await fetchAllPages<Row>(OPS_TEAM_TABLE_ID);
  const byEmail = new Map<string, OpsPerson>();
  const byFirstName = new Map<string, OpsPerson[]>();
  for (const r of rows) {
    const f = r.fields ?? {};
    if (!f["Active"]) continue;
    const name = String(f["Name"] ?? "").trim();
    if (!name) continue;
    const person: OpsPerson = {
      name,
      teams: Array.isArray(f["Teams"]) ? (f["Teams"] as string[]) : [],
    };

    const email = String(f["Email"] ?? "").trim().toLowerCase();
    if (email) byEmail.set(email, person);

    const key = firstName(name);
    if (key) byFirstName.set(key, [...(byFirstName.get(key) ?? []), person]);
  }
  return { byEmail, byFirstName };
});

/**
 * Who, out of the roster, is this signed-in Google account?
 *
 * Email is the answer when the Email column is filled in — an address is exact, and it is the
 * only one of the two a person cannot accidentally collide with.
 *
 * Failing that, the first name off the Google profile, and **only when exactly one active person
 * answers to it**. The roster is nine distinct first names and the forms have always recorded a
 * first name, so this is the same identifier by a different route, not a guess. A second Rick
 * makes both Ricks ambiguous and this returns null rather than picking one — the form then just
 * asks, which is what it did before any of this existed.
 *
 * Getting this wrong writes the wrong person's name onto a booking, so it fails closed.
 */
export async function opsPersonForSession(
  user: { email?: string | null; name?: string | null } | null | undefined,
): Promise<OpsPerson | null> {
  const roster = await loadOpsRoster();

  const email = String(user?.email ?? "").trim().toLowerCase();
  if (email) {
    const byEmail = roster.byEmail.get(email);
    if (byEmail) return byEmail;
  }

  const key = firstName(String(user?.name ?? ""));
  if (!key) return null;
  const candidates = roster.byFirstName.get(key) ?? [];
  return candidates.length === 1 ? candidates[0] : null;
}
