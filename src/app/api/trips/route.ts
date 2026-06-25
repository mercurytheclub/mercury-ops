import { loadTrips } from "@/server/airtable";

// JSON endpoint for trips. Server-only — the Airtable token never leaves here.
// The cache lives in the loader; this just hands back the shaped list.
export async function GET() {
  const trips = await loadTrips();
  return Response.json({ trips });
}
