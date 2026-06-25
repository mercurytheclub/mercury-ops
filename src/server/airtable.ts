import "server-only";

// Server-only Airtable client for mercury-ops.
//
// Same architecture as mercury-consumer/server: the browser NEVER holds the
// Airtable token — all reads happen here, in server-only code, and the UI
// receives shaped data. Airtable is the source of truth; we read it, we don't
// duplicate its schema. Tables are referenced by ID (names/emoji can change).
//
// The patterns below (paginated fetch, single-flight SWR cache, linked-record
// resolution) are ported from the consumer server so the two stay consistent.

const BASE_ID = "app6LKGIKc3rUeHiP";

// Real table IDs (shared with the consumer base).
const TRIPS_TABLE_ID = "tblmESP7ooV2ZWSr6"; // Trips
const GUESTS_TABLE_ID = "tblXcehCFamvNdOae"; // Guest Information

const TOKEN = process.env.AIRTABLE_TOKEN;

// Freshness window: served instantly while fresh; past it, served stale while a
// background refresh fires (stale-while-revalidate). Airtable's per-base limit
// is 5 req/sec, so the cache also keeps us well under that.
const CACHE_TTL_MS = 90_000;
const CACHE_MAX_STALE_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Single-flight SWR cache (ported from the consumer server)
// ---------------------------------------------------------------------------

function makeCached<T>(
  fetcher: () => Promise<T>,
  ttlMs = CACHE_TTL_MS,
  maxStaleMs = CACHE_MAX_STALE_MS,
): () => Promise<T> {
  let cache: { ts: number; value: T } | null = null;
  let inFlight: Promise<T> | null = null;
  const run = (): Promise<T> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const value = await fetcher();
        cache = { ts: Date.now(), value };
        return value;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return async (): Promise<T> => {
    if (cache) {
      const age = Date.now() - cache.ts;
      if (age < ttlMs) return cache.value;
      if (age < maxStaleMs) {
        run().catch(() => {});
        return cache.value;
      }
      try {
        return await run();
      } catch {
        return cache.value;
      }
    }
    return run();
  };
}

// ---------------------------------------------------------------------------
// Paginated fetch (Airtable pages at 100 records; walk the offset cursor)
// ---------------------------------------------------------------------------

type AirtablePage<T> = { records: T[]; offset?: string };

async function fetchAirtablePage<T>(tableId: string, offset?: string): Promise<AirtablePage<T>> {
  const params = new URLSearchParams({ pageSize: "100" });
  if (offset) params.set("offset", offset);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    throw new Error(`Airtable fetch failed for ${tableId}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as AirtablePage<T>;
}

async function fetchAllPages<T>(tableId: string): Promise<T[]> {
  const all: T[] = [];
  let offset: string | undefined;
  do {
    const page = await fetchAirtablePage<T>(tableId, offset);
    all.push(...page.records);
    offset = page.offset;
  } while (offset);
  return all;
}

// Airtable returns linked-record fields as bare arrays of record IDs.
type LinkedRecord = { id: string } | string;
function linkedIds(field: unknown): string[] {
  if (!Array.isArray(field)) return [];
  return field.map((v) => (typeof v === "string" ? v : v?.id)).filter(Boolean) as string[];
}

// ---------------------------------------------------------------------------
// Guests — id → display name (to resolve Trip "Lead Guest" links)
// ---------------------------------------------------------------------------

type GuestsAirtableRow = {
  id: string;
  fields: { "Full Name"?: string };
};

const loadGuestsMap = makeCached(async () => {
  const map = new Map<string, string>();
  if (!TOKEN) return map;
  const rows = await fetchAllPages<GuestsAirtableRow>(GUESTS_TABLE_ID);
  for (const row of rows) map.set(row.id, row.fields["Full Name"] ?? "");
  return map;
});

// ---------------------------------------------------------------------------
// Trips — the first ops surface
// ---------------------------------------------------------------------------

type TripAirtableRow = {
  id: string;
  fields: {
    "Trip ID"?: string;
    "External Trip Name"?: string;
    "Trip Start Date"?: string;
    "Trip End Date"?: string;
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
    "Status"?: string;
    "Lead Destination"?: string;
  };
};

/** Lean trip summary for the ops list. Full reservation hydration comes later. */
export type OpsTrip = {
  tripCode: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  leadGuest: string;
  guestCount: number;
  status: string | null;
  leadDestination: string | null;
  /** Derived from dates vs. now — drives the ops list grouping. */
  timeframe: "in_progress" | "upcoming" | "past" | "undated";
};

function timeframeOf(start: string | null, end: string | null, now: Date): OpsTrip["timeframe"] {
  if (!start) return "undated";
  const today = now.toISOString().slice(0, 10);
  if (end && end < today) return "past";
  if (start > today) return "upcoming";
  return "in_progress"; // started, not yet ended
}

/**
 * All trips, shaped for the ops list and sorted by start date (soonest first,
 * undated last). Cached + de-duped so concurrent requests share one fan-out.
 */
export const loadTrips = makeCached(async (): Promise<OpsTrip[]> => {
  if (!TOKEN) {
    console.warn("AIRTABLE_TOKEN not set — trips unavailable (set it in .env.local)");
    return [];
  }
  const [rows, guests] = await Promise.all([
    fetchAllPages<TripAirtableRow>(TRIPS_TABLE_ID),
    loadGuestsMap(),
  ]);
  const now = new Date();
  const trips = rows.map((row): OpsTrip => {
    const f = row.fields;
    const leadIds = linkedIds(f["Lead Guest"]);
    const start = f["Trip Start Date"] ?? null;
    const end = f["Trip End Date"] ?? null;
    return {
      tripCode: f["Trip ID"] ?? row.id,
      name: f["External Trip Name"] ?? f["Trip ID"] ?? "untitled trip",
      startDate: start,
      endDate: end,
      leadGuest: (leadIds[0] && guests.get(leadIds[0])) || "—",
      guestCount: leadIds.length + linkedIds(f["Companions"]).length,
      status: f["Status"] ?? null,
      leadDestination: f["Lead Destination"] ?? null,
      timeframe: timeframeOf(start, end, now),
    };
  });
  return trips.sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });
});
