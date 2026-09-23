import "server-only";
import { fetchAllPages, makeCached } from "@/server/airtable";

// The ops roster, read from 🧑 Ops Team. This exists so a signed-in person can be recognised by
// the n8n forms: they sign in with Google, we map that address to the name the forms and cards
// have always used, and the form fills its own "who is doing this" field in.
//
// The email lives here and never goes to the browser. The forms are public URLs; the first names
// on them are not a secret, staff addresses are, and nothing on a form needs one — the only thing
// that crosses the wire is the matched name.

const OPS_TEAM_TABLE_ID = "tblkNYq2BnBcV7oqE"; // 🧑 Ops Team

type Row = { id: string; fields: Record<string, unknown> };

export type OpsPerson = { name: string; teams: string[] };

/** Active roster, keyed by lowercased email. A row with no email simply cannot be matched. */
export const loadOpsTeamByEmail = makeCached(async (): Promise<Map<string, OpsPerson>> => {
  const rows = await fetchAllPages<Row>(OPS_TEAM_TABLE_ID);
  const byEmail = new Map<string, OpsPerson>();
  for (const r of rows) {
    const f = r.fields ?? {};
    if (!f["Active"]) continue;
    const name = String(f["Name"] ?? "").trim();
    const email = String(f["Email"] ?? "").trim().toLowerCase();
    if (!name || !email) continue;
    byEmail.set(email, { name, teams: Array.isArray(f["Teams"]) ? (f["Teams"] as string[]) : [] });
  }
  return byEmail;
});

export async function opsPersonForEmail(email: string | null | undefined): Promise<OpsPerson | null> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return null;
  return (await loadOpsTeamByEmail()).get(e) ?? null;
}
