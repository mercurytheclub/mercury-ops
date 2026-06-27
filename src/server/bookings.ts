import "server-only";

// Booking write layer for the ops app. Reads a single record's editable fields
// for the drawer, and writes edits/creates back to Airtable via the REST API
// (the token has write scope). Tables + field names come from the shared config.

import { BASE_ID, TOKEN, fetchAllPages, linkedIds, loadTripRows } from "./airtable";
import { BOOKING_CONFIG, LINK_CONFIG, type BookingType, type LinkableType, type FieldDef } from "@/lib/bookingFields";

/** Form value shape: strings for scalars, string[] for multiselect. */
export type BookingValues = Record<string, string | string[]>;

const api = (path: string) => `https://api.airtable.com/v0/${BASE_ID}/${path}`;
const authHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

// Airtable value -> form value (always a string or string[] for the inputs).
function toFormValue(field: FieldDef, raw: unknown): string | string[] {
  if (raw == null) return field.kind === "multiselect" ? [] : "";
  if (field.kind === "multiselect") return Array.isArray(raw) ? (raw as string[]) : [];
  if (field.kind === "date") return String(raw).slice(0, 10);
  if (field.kind === "number") return typeof raw === "number" ? String(raw) : String(raw);
  return String(raw);
}

// Form value -> Airtable value, dropping empties (so a blank field clears).
function toAirtableValue(field: FieldDef, value: string | string[] | undefined): unknown {
  if (field.kind === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    return arr;
  }
  const v = typeof value === "string" ? value.trim() : "";
  // Empty → null clears the field (and avoids Airtable trying to create an
  // empty single-select option, which 422s).
  if (v === "") return null;
  if (field.kind === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

/** Load the editable fields of one booking record for the edit drawer. */
export async function getBookingForEdit(
  type: BookingType,
  recordId: string,
): Promise<BookingValues | null> {
  const cfg = BOOKING_CONFIG[type];
  if (!cfg || !TOKEN) return null;
  const res = await fetch(api(`${cfg.tableId}/${recordId}`), { headers: authHeaders, cache: "no-store" });
  if (!res.ok) return null;
  const record = (await res.json()) as { fields: Record<string, unknown> };
  const out: BookingValues = {};
  for (const f of cfg.fields) out[f.name] = toFormValue(f, record.fields[f.name]);
  return out;
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Create (no recordId) or update (recordId) a booking. On create, the record is
 * linked to the trip and given the default Status so it surfaces on the itinerary.
 */
export async function saveBooking(input: {
  type: BookingType;
  recordId?: string | null;
  tripRecordId?: string | null;
  values: BookingValues;
}): Promise<SaveResult> {
  const cfg = BOOKING_CONFIG[input.type];
  if (!cfg) return { ok: false, error: "unknown booking type" };
  if (!TOKEN) return { ok: false, error: "no Airtable token" };

  const fields: Record<string, unknown> = {};
  for (const f of cfg.fields) {
    fields[f.name] = toAirtableValue(f, input.values[f.name]);
  }

  const isCreate = !input.recordId;
  if (isCreate) {
    if (!input.tripRecordId) return { ok: false, error: "missing trip" };
    fields["Trip ID"] = [input.tripRecordId];
    if (cfg.defaultStatus && !fields[cfg.defaultStatus.field]) {
      fields[cfg.defaultStatus.field] = cfg.defaultStatus.value;
    }
  }

  try {
    const res = isCreate
      ? await fetch(api(cfg.tableId), {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ fields }),
        })
      : await fetch(api(`${cfg.tableId}/${input.recordId}`), {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ fields }),
        });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Airtable ${res.status}: ${text.slice(0, 300)}` };
    }
    const saved = (await res.json()) as { id: string };
    return { ok: true, id: saved.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Linking an EXISTING booking onto a trip (attach + optionally place on a day)
// ---------------------------------------------------------------------------

type AnyRow = { id: string; fields: Record<string, unknown> };

/** An existing booking the team can attach to this trip. */
export type LinkableBooking = {
  recordId: string;
  type: LinkableType;
  title: string;
  date: string | null;
  time: string | null;
  /** Trip codes this booking is already linked to (shown so the move is clear). */
  otherTripCodes: string[];
};

// Quote-safe value for an Airtable formula string literal.
function esc(s: string): string {
  return s.replace(/["\\]/g, " ").trim();
}

/**
 * Existing bookings of one type matching `query` by name, EXCLUDING any already
 * on this trip (and cancelled ones). A name filter keeps the fetch tiny — we
 * never load a whole booking table. Needs ≥2 query chars to run.
 */
export async function searchLinkableBookings(
  type: LinkableType,
  tripCode: string,
  query: string,
): Promise<LinkableBooking[]> {
  const cfg = LINK_CONFIG[type];
  if (!cfg || !TOKEN) return [];
  const q = esc(query);
  if (q.length < 2) return [];
  const { titleField, dateField, timeField } = cfg;

  // Exclude bookings already on THIS trip. Bound the code with commas on both
  // sides (and the joined list too) so one code can't substring-match another.
  const formula = `AND(SEARCH(LOWER("${q}"), LOWER({${titleField}} & "")), NOT(FIND(",${esc(tripCode)},", "," & ARRAYJOIN({Trip ID}) & ",")), NOT(FIND("ancel", {Status} & "")))`;

  const [rows, trips] = await Promise.all([
    fetchAllPages<AnyRow>(cfg.tableId, formula),
    loadTripRows(),
  ]);
  const codeById = new Map(trips.map((t) => [t.id, (t.fields["Trip ID"] ?? t.id) as string]));

  return rows.slice(0, 30).map((r): LinkableBooking => {
    const f = r.fields;
    const rawTitle = f[titleField];
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : cfg.label;
    return {
      recordId: r.id,
      type,
      title,
      date: typeof f[dateField] === "string" ? (f[dateField] as string).slice(0, 10) : null,
      time: timeField && typeof f[timeField] === "string" ? (f[timeField] as string) : null,
      otherTripCodes: linkedIds(f["Trip ID"]).map((id) => codeById.get(id) ?? id),
    };
  });
}

/**
 * Attach an existing booking to a trip by SETTING its Trip ID to this trip.
 * The itinerary filters bookings with an exact `ARRAYJOIN({Trip ID})="code"`
 * match, so a booking belongs to exactly one trip — a booking already on
 * another trip is moved here (the picker shows its current trip first, and the
 * search excludes anything already on this trip). When `date` is given, the
 * booking is placed on that day; its time field is untouched, so a real
 * reservation keeps its clock time.
 */
export async function linkBooking(input: {
  type: LinkableType;
  recordId: string;
  tripRecordId: string;
  date?: string | null;
}): Promise<SaveResult> {
  const cfg = LINK_CONFIG[input.type];
  if (!cfg) return { ok: false, error: "unknown booking type" };
  if (!TOKEN) return { ok: false, error: "no Airtable token" };

  const fields: Record<string, unknown> = { "Trip ID": [input.tripRecordId] };
  if (input.date) fields[cfg.dateField] = input.date;

  try {
    const res = await fetch(api(`${cfg.tableId}/${input.recordId}`), {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Airtable ${res.status}: ${text.slice(0, 300)}` };
    }
    const saved = (await res.json()) as { id: string };
    return { ok: true, id: saved.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
