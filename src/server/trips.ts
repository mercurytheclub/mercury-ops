import "server-only";

// Trip write layer for the ops app. Creates a new Trip (and, when the picker
// supplies a name with no existing record, a new Guest) via the Airtable REST
// API — the same token + pattern as the booking writes in ./bookings.
//
// What we DON'T write: Trip ID, Trip Number, Internal/External Trip Name are all
// computed (autoNumber/formula) in Airtable. The trip's display name is derived
// as `{Lead Destination} - {Start Date:MMM YYYY}`, so the form drives the name
// through Lead Destination + Start Date — never a free-text name field.

import { BASE_ID, TOKEN, timeframeOf, loadTripRows, loadTrips, type OpsTrip } from "./airtable";

const TRIPS_TABLE_ID = "tblmESP7ooV2ZWSr6"; // 🧳 Trips
const GUESTS_TABLE_ID = "tblXcehCFamvNdOae"; // Guest Information

const api = (path: string) => `https://api.airtable.com/v0/${BASE_ID}/${path}`;
const authHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

/** A guest chosen in the picker: an existing record (id) or a new one (name). */
export type GuestRef = { id?: string | null; name: string; isNew?: boolean };

export type CreateTripInput = {
  leadDestination: string;
  startDate?: string | null;
  endDate?: string | null;
  leadGuest?: GuestRef | null;
  companions?: GuestRef[];
};

export type CreateTripResult = { ok: true; trip: OpsTrip } | { ok: false; error: string };

/** Split a free-typed full name into Given Names + Last Name for a new guest. */
function splitName(full: string): { given: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { given: parts[0], last: "" };
  const last = parts.pop() as string;
  return { given: parts.join(" "), last };
}

/** Create a Guest Information record from a typed name; returns its record id. */
async function createGuest(name: string): Promise<string> {
  const { given, last } = splitName(name);
  const res = await fetch(api(GUESTS_TABLE_ID), {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ fields: { "Given Names": given, "Last Name": last } }),
  });
  if (!res.ok) {
    throw new Error(`couldn't create guest "${name}" (Airtable ${res.status})`);
  }
  return ((await res.json()) as { id: string }).id;
}

/** Resolve a picker ref to a record id, creating the guest if it's new. */
async function resolveGuest(ref: GuestRef | null | undefined): Promise<string | null> {
  if (!ref) return null;
  if (ref.id) return ref.id;
  if (ref.name?.trim()) return createGuest(ref.name);
  return null;
}

/**
 * Create a trip. Resolves the lead guest + companions (creating new guest
 * records as needed), writes the Trip, and returns a shaped OpsTrip so the list
 * can show it instantly (the read cache may lag a created record by up to ~90s).
 */
export async function createTrip(input: CreateTripInput): Promise<CreateTripResult> {
  if (!TOKEN) return { ok: false, error: "no Airtable token" };
  const destination = input.leadDestination.trim();
  if (!destination) return { ok: false, error: "a destination is required" };

  try {
    const leadId = await resolveGuest(input.leadGuest);
    const companionIds = (
      await Promise.all((input.companions ?? []).map((c) => resolveGuest(c)))
    ).filter((id): id is string => Boolean(id));

    const fields: Record<string, unknown> = { "Lead Destination": destination };
    if (input.startDate) fields["Trip Start Date"] = input.startDate;
    if (input.endDate) fields["Trip End Date"] = input.endDate;
    if (leadId) fields["Lead Guest"] = [leadId];
    if (companionIds.length) fields["Companions"] = companionIds;

    const res = await fetch(api(TRIPS_TABLE_ID), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Airtable ${res.status}: ${text.slice(0, 300)}` };
    }

    const saved = (await res.json()) as { id: string; fields: Record<string, unknown> };
    // Drop the in-memory trip caches so a reload right after creating shows it.
    loadTripRows.bust();
    loadTrips.bust();

    const start = input.startDate || null;
    const end = input.endDate || null;
    const leadName = input.leadGuest?.name?.trim();
    const guestCount = (leadId ? 1 : 0) + companionIds.length;

    const trip: OpsTrip = {
      tripCode: (saved.fields["Trip ID"] as string) || saved.id,
      name: (saved.fields["External Trip Name"] as string) || deriveName(destination, start),
      startDate: start,
      endDate: end,
      leadGuest: leadName || "—",
      guestCount,
      status: null,
      leadDestination: destination,
      timeframe: timeframeOf(start, end, new Date()),
    };
    return { ok: true, trip };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Mirror Airtable's External Trip Name formula for the optimistic fallback. */
function deriveName(destination: string, start: string | null): string {
  if (!start) return `${destination} -`;
  const [y, m] = start.split("-");
  const mon = MONTHS[parseInt(m, 10) - 1];
  return mon ? `${destination} - ${mon} ${y}` : destination;
}
