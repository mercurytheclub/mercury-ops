import { loadItinerary } from "@/server/itinerary";

// Full admin itinerary for one trip, as JSON. Server-only; includes the
// internal cost/supplier block the guest app omits.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tripCode: string }> },
) {
  const { tripCode } = await params;
  const itinerary = await loadItinerary(decodeURIComponent(tripCode));
  if (!itinerary) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(itinerary);
}
