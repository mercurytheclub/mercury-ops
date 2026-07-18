import "server-only";
import { unstable_cache } from "next/cache";

// Per-trip itinerary for the OPS (admin) app. Unlike the guest-facing consumer
// app, this surfaces internal fields — cost lines, supplier + contact, record
// locators, internal notes — read straight from the booking tables.
//
// Each category loader reads its whole table once (cached), filters to the
// requested trip by the linked "Trip ID" record, and shapes rows into the
// unified Reservation below. buildItinerary() then groups them by day across
// the trip's date span. Add a new category by writing one loader and listing it
// in CATEGORY_LOADERS — nothing else changes.

import {
  TOKEN,
  fetchAllPages,
  tripFilter,
  MASTER_REVALIDATE_S,
  makeCached,
  linkedIds,
  combineDateTime,
  loadGuestsMap,
  loadTripRows,
  resolveGuestNames,
  type LinkedRecord,
  type TripAirtableRow,
} from "./airtable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Category =
  | "flight"
  | "hotel"
  | "car"
  | "restaurant"
  | "activity"
  | "villa"
  | "greeter"
  | "cruise"
  | "private_flight"
  | "rental_car"
  | "helicopter"
  | "vip_terminal"
  | "vip_event"
  | "train"
  | "luxury_train"
  | "yacht_charter"
  | "yacht_short";

export type CostLine = { label: string; amount: number; currency: string };

/** One labelled field shown in the internal panel. */
export type Detail = { label: string; value: string };

/** Internal, ops-only block — the full picture for a booking. Never guest-facing. */
export type AdminBlock = {
  /** Money lines (right-aligned, currency-formatted). */
  cost: CostLine[];
  /** Every other relevant field as label → value (supplier, contact, refs, …). */
  details: Detail[];
};

export type Reservation = {
  id: string;
  category: Category;
  /** Floating local ISO ("YYYY-MM-DDTHH:MM:SS"). Drives day bucketing + sort. */
  startAt: string;
  endAt: string | null;
  title: string;
  subtitle: string | null;
  location: string | null;
  guests: string[];
  confirmation: string | null;
  admin: AdminBlock;
  /** Internal — trip record id used for filtering; stripped before returning. */
  _tripRecordId: string;
};

export type ItineraryDay = { date: string; reservations: Reservation[] };

export type ItineraryDetail = {
  tripCode: string;
  /** Airtable record id of the Trip — needed to link newly created bookings. */
  tripRecordId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string | null;
  guests: { name: string; role: "lead" | "guest" }[];
  days: ItineraryDay[];
  /** Roll-up of every cost line across the trip, by currency. Ops-only. */
  totals: { currency: string; amount: number }[];
};

// ---------------------------------------------------------------------------
// Shaping helpers
// ---------------------------------------------------------------------------

const isCancelled = (status: unknown) =>
  typeof status === "string" && status.toLowerCase().includes("cancel");

function money(amount: unknown, currency = "USD"): CostLine | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) return null;
  return { label: "", amount, currency };
}

function costLines(...entries: ([string, unknown] | [string, unknown, string])[]): CostLine[] {
  const out: CostLine[] = [];
  for (const [label, amount, currency] of entries) {
    const m = money(amount, currency ?? "USD");
    if (m) out.push({ ...m, label });
  }
  return out;
}

const contactOf = (name: unknown, phone: unknown): string | null => {
  const parts = [name, phone].filter((v) => typeof v === "string" && v.trim());
  return parts.length ? parts.join(" · ") : null;
};

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// ── Detail builders ─────────────────────────────────────────────────────────
// Turn an Airtable value into a display string; empty/false → "" (dropped).
function fmtVal(v: unknown): string {
  if (v == null || v === false) return "";
  if (v === true) return "Yes";
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).join(", ");
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim();
}

/** Build a details list from [label, value] pairs, dropping empties. */
function detailsOf(...entries: [string, unknown][]): Detail[] {
  const out: Detail[] = [];
  for (const [label, v] of entries) {
    const s = fmtVal(v);
    if (s) out.push({ label, value: s });
  }
  return out;
}

const joinDot = (...parts: unknown[]): string =>
  parts.map((p) => fmtVal(p)).filter(Boolean).join(" · ");

/** "Mon D · 9:00 AM" from a date + free-text time (either may be empty). */
function whenStr(date: unknown, time: unknown): string {
  const d = typeof date === "string" ? fmtDateShort(date) : "";
  return [d, fmtVal(time)].filter(Boolean).join(" · ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateShort(d: string): string {
  const s = d.slice(0, 10).split("-");
  if (s.length !== 3) return d;
  const m = MONTHS[parseInt(s[1], 10) - 1];
  return m ? `${m} ${parseInt(s[2], 10)}` : d;
}

/** Whole nights between two YYYY-MM-DD dates (for stays). */
function nightsBetween(a: unknown, b: unknown): string {
  if (typeof a !== "string" || typeof b !== "string") return "";
  const t1 = new Date(a.slice(0, 10) + "T00:00:00Z").getTime();
  const t2 = new Date(b.slice(0, 10) + "T00:00:00Z").getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return "";
  const n = Math.round((t2 - t1) / 86_400_000);
  return `${n} night${n === 1 ? "" : "s"}`;
}

/** A category loader: reservations for ONE trip (filtered server-side by Trip ID). */
type Loader = (guests: Map<string, string>, tripCode: string) => Promise<Reservation[]>;

// Booking rows often leave the denormalized name text blank, carrying only a
// link to the master row. Resolve id → primary-field name so titles are never
// generic ("Hotel"). One cached map per master table.
type NameRow = { id: string; fields: Record<string, unknown> };
function nameMapLoader(tableId: string, primaryField: string) {
  // Cache the assembled id→name entries (serializable) for an hour — masters
  // change rarely. Pagination inside runs uncached so offsets stay valid.
  const fetchEntries = unstable_cache(
    async (): Promise<[string, string][]> => {
      if (!TOKEN) return [];
      const entries: [string, string][] = [];
      for (const row of await fetchAllPages<NameRow>(tableId)) {
        const name = row.fields[primaryField];
        if (typeof name === "string" && name.trim()) entries.push([row.id, name.trim()]);
      }
      return entries;
    },
    [`mercury-master-${tableId}`],
    { revalidate: MASTER_REVALIDATE_S },
  );
  return makeCached(async () => new Map(await fetchEntries()));
}

const loadHotelNames = nameMapLoader("tblPnBimrs9eLjooQ", "Hotel Name");
const loadRestaurantNames = nameMapLoader("tblxpKxRFuytOAawA", "Restaurant Name");
const loadActivityNames = nameMapLoader("tblawM4QCpAm01P8w", "Activity Name");
// Airlines master — resolves a flight's linked "Codeshare Airline" to its name.
// Ops-only: the codeshare is surfaced in this admin view, never in the guest app.
const loadAirlineNames = nameMapLoader("tblSKy35woGrE6EcC", "Airline Name");

/** First linked master name, or null. */
function masterName(field: unknown, names: Map<string, string>): string | null {
  const id = linkedIds(field)[0];
  return (id && names.get(id)) || null;
}

// ---------------------------------------------------------------------------
// Flights — one row per guest; collapse rows sharing (trip, flight#, dep date).
// ---------------------------------------------------------------------------

type FlightRow = {
  id: string;
  fields: {
    // Airtable renamed "Flight Number" → "Flight Number (Operating Airline)"
    // in the 2026-07-16 codeshare migration (and "Airline" → "Operating
    // Airline"). Read the new name first, legacy as fallback so a rename in
    // either direction can't silently blank every flight number again.
    "Flight Number (Operating Airline)"?: string;
    "Flight Number"?: string;
    "Trip ID"?: LinkedRecord[];
    "Guest"?: LinkedRecord[];
    "Departure Airport Code"?: string;
    "Arrival Airport Code"?: string;
    "Flight Departure Date"?: string;
    "Flight Departure Time"?: string;
    "Flight Arrival Date"?: string;
    "Flight Arrival Time"?: string;
    "Cabin"?: string;
    // Codeshare: the marketing airline the ticket was sold under, linked to the
    // Airlines master. Ops-facing only for now — not surfaced in the guest app.
    "Codeshare"?: boolean;
    "Codeshare Airline"?: LinkedRecord[];
    "Flight Number (Codeshare Airline)"?: string;
    "Seat Assignment"?: string;
    "Record Locator"?: string;
    "GDS PNR"?: string;
    "Ticket Number"?: string;
    "Ticket Cost"?: number;
    "Taxes & Fees"?: number;
    "Net Cost (Internal Only)"?: number;
    "Total Fare"?: number;
    "Special Meal"?: string;
    "Wheelchair Service"?: boolean;
    "Pet in Cabin"?: boolean;
    "Pet Breed"?: string;
    "Pet Weight"?: string;
    "Status"?: string;
    "Dummy Flight"?: boolean;
  };
};

const loadFlights: Loader = async (guests, tripCode) => {
  const [rows, airlineNames] = await Promise.all([
    fetchAllPages<FlightRow>("tblElrgipumvI2yna", tripFilter(tripCode)),
    loadAirlineNames(),
  ]);
  const byKey = new Map<string, Reservation>();
  for (const row of rows) {
    const f = row.fields;
    if (f["Dummy Flight"] || isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Flight Departure Date"], f["Flight Departure Time"]);
    if (!tripId || !startAt) continue;
    const flightNo = f["Flight Number (Operating Airline)"] ?? f["Flight Number"] ?? "—";
    const key = `${tripId}|${flightNo}|${startAt.slice(0, 10)}`;
    const guestNames = resolveGuestNames(guests, f["Guest"]);
    // Codeshare (ops-only): the marketing airline the ticket was sold under,
    // plus its flight number when present. Guarded on the airline so a stray
    // flight number never shows up mislabelled as an airline.
    const codeshareAirline = masterName(f["Codeshare Airline"], airlineNames);
    const codeshare = codeshareAirline
      ? joinDot(codeshareAirline, f["Flight Number (Codeshare Airline)"])
      : "";
    let res = byKey.get(key);
    if (!res) {
      res = {
        id: `flight-${row.id}`,
        category: "flight",
        startAt,
        endAt: combineDateTime(f["Flight Arrival Date"], f["Flight Arrival Time"]),
        title: `${f["Departure Airport Code"] ?? "???"} → ${f["Arrival Airport Code"] ?? "???"}`,
        subtitle: [flightNo, f["Cabin"]].filter(Boolean).join(" · ") || null,
        location: null,
        guests: [],
        confirmation: text(f["Record Locator"]) ?? text(f["GDS PNR"]),
        admin: {
          cost: costLines(
            ["Ticket cost", f["Ticket Cost"]],
            ["Taxes & fees", f["Taxes & Fees"]],
            ["Total fare", f["Total Fare"]],
            ["Net cost (internal)", f["Net Cost (Internal Only)"]],
          ),
          details: detailsOf(
            ["Departs", whenStr(f["Flight Departure Date"], f["Flight Departure Time"])],
            ["Arrives", whenStr(f["Flight Arrival Date"], f["Flight Arrival Time"])],
            ["Cabin", f["Cabin"]],
            ["Codeshare airline", codeshare],
            ["Seat", f["Seat Assignment"]],
            ["Record locator", f["Record Locator"]],
            ["GDS PNR", f["GDS PNR"]],
            ["Ticket #", f["Ticket Number"]],
            ["Special meal", f["Special Meal"]],
            ["Wheelchair", f["Wheelchair Service"]],
            ["Pet in cabin", f["Pet in Cabin"] ? joinDot(f["Pet Breed"], f["Pet Weight"]) || true : ""],
            ["Status", f["Status"]],
          ),
        },
        _tripRecordId: tripId,
      };
      byKey.set(key, res);
    }
    for (const g of guestNames) if (!res.guests.includes(g)) res.guests.push(g);
  }
  return [...byKey.values()];
};

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

type HotelRow = {
  id: string;
  fields: {
    "Hotel Name"?: string;
    "Room Category"?: string;
    "Check In Date"?: string;
    "Check In Time"?: string;
    "Check Out Date"?: string;
    "Number of Guests"?: number;
    "Confirmation Number"?: string;
    "Booking Currency"?: string;
    "BC - Grand Total"?: number;
    "GPC - Grand Total"?: number;
    "Pre-Tax Subtotal"?: number;
    "Base Rate"?: number;
    "Guest Loyalty Number"?: string;
    "Agent Loyalty ID"?: string;
    "Early Check-In"?: string;
    "Late Check-Out"?: string;
    "Crib"?: string;
    "Rollaway Bed"?: string;
    "Connecting Rooms"?: string;
    "Accessible Room"?: string;
    "Cancellation Policy"?: string;
    "Status"?: string;
    "Trip ID"?: LinkedRecord[];
    "Hotel"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
    "Guest"?: LinkedRecord[];
  };
};

const loadHotels: Loader = async (guests, tripCode) => {
  const [rows, names] = await Promise.all([
    fetchAllPages<HotelRow>("tblZeoVNQyq2wWUtV", tripFilter(tripCode)),
    loadHotelNames(),
  ]);
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Check In Date"], f["Check In Time"]);
    if (!tripId || !startAt) continue;
    const cur = text(f["Booking Currency"]) ?? "USD";
    const hotelName = text(f["Hotel Name"]) ?? masterName(f["Hotel"], names) ?? "Hotel";
    out.push({
      id: `hotel-${row.id}`,
      category: "hotel",
      startAt,
      endAt: combineDateTime(f["Check Out Date"], null),
      title: hotelName,
      subtitle: text(f["Room Category"]),
      location: null,
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"], f["Guest"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: costLines(
          ["Grand total (booking ccy)", f["BC - Grand Total"], cur],
          ["Grand total (guest price)", f["GPC - Grand Total"], "USD"],
          ["Pre-tax subtotal", f["Pre-Tax Subtotal"], cur],
          ["Base rate", f["Base Rate"], cur],
        ),
        details: detailsOf(
          ["Hotel", hotelName],
          ["Check-in", whenStr(f["Check In Date"], f["Check In Time"])],
          ["Check-out", fmtDateShort(text(f["Check Out Date"]) ?? "")],
          ["Nights", nightsBetween(f["Check In Date"], f["Check Out Date"])],
          ["Room", text(f["Room Category"])],
          ["Guests", f["Number of Guests"]],
          ["Currency", text(f["Booking Currency"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Guest loyalty #", text(f["Guest Loyalty Number"])],
          ["Agent loyalty ID", text(f["Agent Loyalty ID"])],
          ["Early check-in", text(f["Early Check-In"])],
          ["Late check-out", text(f["Late Check-Out"])],
          ["Connecting rooms", text(f["Connecting Rooms"])],
          ["Crib", text(f["Crib"])],
          ["Rollaway bed", text(f["Rollaway Bed"])],
          ["Accessible room", text(f["Accessible Room"])],
          ["Cancellation policy", text(f["Cancellation Policy"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Villas
// ---------------------------------------------------------------------------

type VillaRow = {
  id: string;
  fields: {
    "Property Name"?: string;
    "Property Type"?: string;
    "Address"?: string;
    "Bedrooms"?: number;
    "Sleeps"?: number;
    "Check In Date"?: string;
    "Check Out Date"?: string;
    "Confirmation Number"?: string;
    "Currency"?: string;
    "Base Nightly Rate"?: number;
    "Pre-Tax Subtotal"?: number;
    "Grand Total"?: number;
    "Crib"?: string;
    "Chef"?: string;
    "Housekeeping"?: string;
    "Private Driver"?: string;
    "Butler Service"?: string;
    "Breakfast"?: string;
    "Check-in Instructions"?: string;
    "Cancellation Policy"?: string;
    "Status"?: string;
    "Trip ID"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
  };
};

const loadVillas: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<VillaRow>("tblNwLeS5fuj3qulQ", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Check In Date"], null);
    if (!tripId || !startAt) continue;
    const cur = text(f["Currency"]) ?? "USD";
    out.push({
      id: `villa-${row.id}`,
      category: "villa",
      startAt,
      endAt: combineDateTime(f["Check Out Date"], null),
      title: text(f["Property Name"]) ?? "Villa",
      subtitle: text(f["Property Type"]),
      location: text(f["Address"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: costLines(
          ["Base nightly rate", f["Base Nightly Rate"], cur],
          ["Pre-tax subtotal", f["Pre-Tax Subtotal"], cur],
          ["Grand total", f["Grand Total"], cur],
        ),
        details: detailsOf(
          ["Check-in", fmtDateShort(text(f["Check In Date"]) ?? "")],
          ["Check-out", fmtDateShort(text(f["Check Out Date"]) ?? "")],
          ["Nights", nightsBetween(f["Check In Date"], f["Check Out Date"])],
          ["Bedrooms", f["Bedrooms"]],
          ["Sleeps", f["Sleeps"]],
          ["Address", text(f["Address"])],
          ["Currency", text(f["Currency"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Chef", text(f["Chef"])],
          ["Housekeeping", text(f["Housekeeping"])],
          ["Private driver", text(f["Private Driver"])],
          ["Butler service", text(f["Butler Service"])],
          ["Breakfast", text(f["Breakfast"])],
          ["Crib", text(f["Crib"])],
          ["Check-in instructions", text(f["Check-in Instructions"])],
          ["Cancellation policy", text(f["Cancellation Policy"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Car service
// ---------------------------------------------------------------------------

type CarRow = {
  id: string;
  fields: {
    // Field names match the Airtable Car Service table exactly: it uses the
    // one-word "Pickup" and hyphenated "Drop-off" (not "Pick Up"/"Drop Off").
    "Service Mode"?: string;
    "Vehicle Type"?: string;
    "Confirmation #"?: string;
    "Driver Name"?: string;
    "Driver Phone"?: string;
    "Pickup Address"?: string;
    "Pickup (Short)"?: string;
    "Drop-off (Short)"?: string;
    "Pickup Date"?: string;
    "Pickup Time"?: string;
    "Drop-off Address"?: string;
    "Drop-off Date"?: string;
    "Drop-off Time"?: string;
    "Duration"?: string;
    "Sedan"?: number;
    "SUV"?: number;
    "Sprinter Van"?: number;
    "Viano"?: number;
    "Hi-Ace"?: number;
    "Alphard"?: number;
    "Luggage Van"?: number;
    "Status"?: string;
    "Trip ID"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
  };
};

const CAR_VEHICLES = ["Sedan", "SUV", "Sprinter Van", "Viano", "Hi-Ace", "Alphard", "Luggage Van"] as const;

const loadCars: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<CarRow>("tblDLF5H4wuOmrAPq", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Pickup Date"], f["Pickup Time"]);
    if (!tripId || !startAt) continue;
    const route = [text(f["Pickup (Short)"]), text(f["Drop-off (Short)"])].filter(Boolean);
    const vehicles = CAR_VEHICLES.filter((v) => Number(f[v]) > 0).map((v) => `${f[v]}× ${v}`).join(", ");
    out.push({
      id: `car-${row.id}`,
      category: "car",
      startAt,
      endAt: combineDateTime(f["Drop-off Date"], f["Drop-off Time"]),
      title: route.length ? route.join(" → ") : text(f["Vehicle Type"]) ?? "Car service",
      subtitle: text(f["Service Mode"]) ?? text(f["Vehicle Type"]),
      location: text(f["Pickup Address"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation #"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Driver", contactOf(f["Driver Name"], f["Driver Phone"])],
          ["Pick-up", joinDot(whenStr(f["Pickup Date"], f["Pickup Time"]), text(f["Pickup Address"]))],
          ["Drop-off", joinDot(whenStr(f["Drop-off Date"], f["Drop-off Time"]), text(f["Drop-off Address"]))],
          ["Duration", text(f["Duration"])],
          ["Vehicles", vehicles],
          ["Confirmation #", text(f["Confirmation #"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

type RestaurantRow = {
  id: string;
  fields: {
    "Restaurant Name"?: string;
    "Cuisine"?: string;
    "Address"?: string;
    "Reservation Date"?: string;
    "Reservation Time"?: string;
    "Number of Guests"?: number;
    "Distance"?: string;
    "Status Detail"?: string;
    "Confirmation Number"?: string;
    "Notes"?: string;
    "Status"?: string;
    "Trip ID"?: LinkedRecord[];
    "Restaurant"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
  };
};

const loadRestaurants: Loader = async (guests, tripCode) => {
  const [rows, names] = await Promise.all([
    fetchAllPages<RestaurantRow>("tbl4o7RIr37vo8Uj5", tripFilter(tripCode)),
    loadRestaurantNames(),
  ]);
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Reservation Date"], f["Reservation Time"]);
    if (!tripId || !startAt) continue;
    const name = text(f["Restaurant Name"]) ?? masterName(f["Restaurant"], names) ?? "Restaurant";
    out.push({
      id: `restaurant-${row.id}`,
      category: "restaurant",
      startAt,
      endAt: null,
      title: name,
      subtitle: text(f["Cuisine"]),
      location: text(f["Address"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Restaurant", name],
          ["Cuisine", text(f["Cuisine"])],
          ["Party size", f["Number of Guests"]],
          ["Address", text(f["Address"])],
          ["Distance", text(f["Distance"])],
          ["Booking status", text(f["Status Detail"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

type ActivityRow = {
  id: string;
  fields: {
    "Activity Name"?: string;
    "Duration"?: string;
    "Description"?: string;
    "Meeting Point"?: string;
    "Operator"?: string;
    "Confirmation Number"?: string;
    "Notes"?: string;
    "Activity Date"?: string;
    "Activity Time"?: string;
    "End Time"?: string;
    "Status"?: string;
    "Contact Name"?: string;
    "Contact Phone"?: string;
    "Trip ID"?: LinkedRecord[];
    "Activity"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
  };
};

const loadActivities: Loader = async (guests, tripCode) => {
  const [rows, names] = await Promise.all([
    fetchAllPages<ActivityRow>("tbli8AU5hA12ROjmi", tripFilter(tripCode)),
    loadActivityNames(),
  ]);
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Activity Date"], f["Activity Time"]);
    if (!tripId || !startAt) continue;
    out.push({
      id: `activity-${row.id}`,
      category: "activity",
      startAt,
      endAt: null,
      title: text(f["Activity Name"]) ?? masterName(f["Activity"], names) ?? "Activity",
      subtitle: text(f["Duration"]),
      location: text(f["Meeting Point"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Operator", text(f["Operator"])],
          ["Contact", contactOf(f["Contact Name"], f["Contact Phone"])],
          ["Starts", whenStr(f["Activity Date"], f["Activity Time"])],
          ["Ends", fmtVal(f["End Time"])],
          ["Duration", text(f["Duration"])],
          ["Meeting point", text(f["Meeting Point"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Description", text(f["Description"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Airport greeters
// ---------------------------------------------------------------------------

type GreeterRow = {
  id: string;
  fields: {
    "Service Type"?: string;
    "Associated Flight"?: string;
    "Service Date"?: string;
    "Service Time"?: string;
    "Greeter Name"?: string;
    "Greeter Phone"?: string;
    "Greeter Email"?: string;
    "Supplier"?: string;
    "Confirmation #"?: string;
    "PNR"?: string;
    "Notes"?: string;
    "Status"?: string;
    "Trip ID"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
  };
};

const loadGreeters: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<GreeterRow>("tblLS8Qc9xarbvtW4", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Service Date"], f["Service Time"]);
    if (!tripId || !startAt) continue;
    const svc = text(f["Service Type"]);
    out.push({
      id: `greeter-${row.id}`,
      category: "greeter",
      startAt,
      endAt: null,
      title: text(f["Supplier"]) ?? "Airport greeter",
      subtitle: [svc, text(f["Associated Flight"])].filter(Boolean).join(" · ") || null,
      location: null,
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation #"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Service", svc],
          ["Flight", text(f["Associated Flight"])],
          ["When", whenStr(f["Service Date"], f["Service Time"])],
          ["Supplier", text(f["Supplier"])],
          ["Greeter", contactOf(f["Greeter Name"], f["Greeter Phone"])],
          ["Greeter email", text(f["Greeter Email"])],
          ["Confirmation #", text(f["Confirmation #"])],
          ["PNR", text(f["PNR"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Cruises ───────────────────────────────────────────────────────────────
type CruiseRow = { id: string; fields: Record<string, unknown> };
const loadCruises: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<CruiseRow>("tblli9V6EUPLr2Acb", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Sailing Date"], f["Embarkation Start Time"]);
    if (!tripId || !startAt) continue;
    const cur = text(f["Currency"]) ?? "USD";
    out.push({
      id: `cruise-${row.id}`,
      category: "cruise",
      startAt,
      endAt: combineDateTime(f["Return Date"], null),
      title: text(f["Ship Name"]) ?? text(f["Itinerary Name"]) ?? "Cruise",
      subtitle: joinDot(f["Itinerary Name"], f["Cabin Class"]) || null,
      location: text(f["Departure Port"]) ?? text(f["Departure City"]),
      guests: resolveGuestNames(guests, f["Guest"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: costLines(
          ["Total cruise fare", f["Total Cruise Fare"], cur],
          ["Taxes & fees", f["Taxes & Fees"], cur],
          ["Total charge", f["Total Charge"], cur],
          ["Amount paid", f["Amount Paid"], cur],
          ["Balance due", f["Balance Due"], cur],
          ["Commission (internal)", f["Total Commission"], cur],
        ),
        details: detailsOf(
          ["Ship", text(f["Ship Name"])],
          ["Itinerary", text(f["Itinerary Name"])],
          ["Cabin", joinDot(f["Cabin Class"], f["Stateroom Category"], f["Stateroom Number"])],
          ["Sailing", whenStr(f["Sailing Date"], f["Embarkation Start Time"])],
          ["Return", text(f["Return Date"]) ? fmtDateShort(String(f["Return Date"])) : ""],
          ["Nights", nightsBetween(f["Sailing Date"], f["Return Date"])],
          ["Departs", joinDot(f["Departure Port"], f["Departure City"])],
          ["Disembarks", joinDot(f["Disembark Port"], f["Disembark City"])],
          ["Booking status", text(f["Booking Status"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Cancellation policy", text(f["Cancellation Policy"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Private flights ─────────────────────────────────────────────────────────
type PrivateFlightRow = { id: string; fields: Record<string, unknown> };
const loadPrivateFlights: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<PrivateFlightRow>("tblD1G2s21Nv4HbNG", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Flight Departure Date"], f["Flight Departure Time"]);
    if (!tripId || !startAt) continue;
    const dep = text(f["Departure Airport"]);
    const arr = text(f["Arrival Airport"]);
    out.push({
      id: `private_flight-${row.id}`,
      category: "private_flight",
      startAt,
      endAt: combineDateTime(f["Flight Arrival Date"], f["Flight Arrival Time"]),
      title: dep && arr ? `${dep} → ${arr}` : "Private flight",
      subtitle: joinDot(f["Operator"], f["Tail Number"]) || null,
      location: text(f["Departure FBO"]) ?? dep,
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: null,
      admin: {
        cost: costLines(
          ["Charter cost", f["Charter Cost"]],
          ["Net cost (internal)", f["Net Cost (Internal Only)"]],
        ),
        details: detailsOf(
          ["Operator", text(f["Operator"])],
          ["Tail number", text(f["Tail Number"])],
          ["Departs", joinDot(whenStr(f["Flight Departure Date"], f["Flight Departure Time"]), text(f["Departure FBO"]))],
          ["Arrives", joinDot(whenStr(f["Flight Arrival Date"], f["Flight Arrival Time"]), text(f["Arrival FBO"]))],
          ["Crew", text(f["Crew Names"])],
          ["Catering", text(f["Catering Notes"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Rental cars ─────────────────────────────────────────────────────────────
type RentalCarRow = { id: string; fields: Record<string, unknown> };
const loadRentalCars: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<RentalCarRow>("tblC5IJe3DtPVqyP6", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Pick Up Date"], f["Pick Up Time"]);
    if (!tripId || !startAt) continue;
    out.push({
      id: `rental_car-${row.id}`,
      category: "rental_car",
      startAt,
      endAt: combineDateTime(f["Drop Off Date"], f["Drop Off Time"]),
      title: text(f["Rental Company"]) ?? "Rental car",
      subtitle: text(f["Vehicle Type"]),
      location: text(f["Pickup Address"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Company", text(f["Rental Company"])],
          ["Vehicle", text(f["Vehicle Type"])],
          ["Pick up", joinDot(whenStr(f["Pick Up Date"], f["Pick Up Time"]), text(f["Pickup Address"]))],
          ["Drop off", joinDot(whenStr(f["Drop Off Date"], f["Drop Off Time"]), text(f["Dropoff Address"]))],
          ["Driver(s)", text(f["Driver Name(s)"])],
          ["Payment", text(f["Payment"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Pick-up notes", text(f["Pickup Instructions"])],
          ["Drop-off notes", text(f["Dropoff Instructions"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Helicopters ─────────────────────────────────────────────────────────────
type HelicopterRow = { id: string; fields: Record<string, unknown> };
const loadHelicopters: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<HelicopterRow>("tblZnCNZtkamdc3ET", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Flight Departure Date"], f["Flight Departure Time"]);
    if (!tripId || !startAt) continue;
    const orig = text(f["Origin Helipad"]) ?? text(f["Departure City"]);
    const dest = text(f["Destination Helipad"]) ?? text(f["Arrival City"]);
    out.push({
      id: `helicopter-${row.id}`,
      category: "helicopter",
      startAt,
      endAt: combineDateTime(f["Flight Arrival Date"], f["Flight Arrival Time"]),
      title: orig && dest ? `${orig} → ${dest}` : "Helicopter",
      subtitle: joinDot(f["Operator"], f["Aircraft Type"]) || null,
      location: text(f["Departure Address"]) ?? text(f["Departure City"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Operator", text(f["Operator"])],
          ["Aircraft", text(f["Aircraft Type"])],
          ["Departs", joinDot(whenStr(f["Flight Departure Date"], f["Flight Departure Time"]), text(f["Departure Address"]))],
          ["Arrives", joinDot(whenStr(f["Flight Arrival Date"], f["Flight Arrival Time"]), text(f["Arrival Address"]))],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── VIP terminals ───────────────────────────────────────────────────────────
type VipTerminalRow = { id: string; fields: Record<string, unknown> };
const loadVipTerminals: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<VipTerminalRow>("tblQrwjoxgum85bY2", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Service Date"], f["Service Time"]);
    if (!tripId || !startAt) continue;
    out.push({
      id: `vip_terminal-${row.id}`,
      category: "vip_terminal",
      startAt,
      endAt: null,
      title: text(f["Airport"]) ? `VIP terminal · ${text(f["Airport"])}` : "VIP terminal",
      subtitle: joinDot(f["Service Type"], f["Associated Flight"]) || null,
      location: text(f["Airport"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Airport", text(f["Airport"])],
          ["Service", text(f["Service Type"])],
          ["Flight", text(f["Associated Flight"])],
          ["When", whenStr(f["Service Date"], f["Service Time"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Status", text(f["Status"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── VIP events ──────────────────────────────────────────────────────────────
type VipEventRow = { id: string; fields: Record<string, unknown> };
const loadVipEvents: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<VipEventRow>("tblRuveDqzottMIyd", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Event Start Date"], f["Event Start Time"]);
    if (!tripId || !startAt) continue;
    out.push({
      id: `vip_event-${row.id}`,
      category: "vip_event",
      startAt,
      endAt: combineDateTime(f["Event End Date"], f["Event End Time"]),
      title: text(f["Event Name"]) ?? "VIP event",
      subtitle: joinDot(f["Event Type"], f["Venue"]) || null,
      location: text(f["Venue"]),
      guests: resolveGuestNames(guests, f["Guest"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Event", text(f["Event Name"])],
          ["Venue", text(f["Venue"])],
          ["Type", text(f["Event Type"])],
          ["Tier / pass", text(f["Tier / Pass"])],
          ["Starts", whenStr(f["Event Start Date"], f["Event Start Time"])],
          ["Ends", whenStr(f["Event End Date"], f["Event End Time"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Trains ──────────────────────────────────────────────────────────────────
type TrainRow = { id: string; fields: Record<string, unknown> };
const loadTrains: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<TrainRow>("tbll8JRoErHvAfdPm", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Departure Date"], f["Departure Time"]);
    if (!tripId || !startAt) continue;
    const orig = text(f["Origin Station"]) ?? text(f["Origin City"]);
    const dest = text(f["Destination Station"]) ?? text(f["Destination City"]);
    out.push({
      id: `train-${row.id}`,
      category: "train",
      startAt,
      endAt: combineDateTime(f["Arrival Date"], f["Arrival Time"]),
      title: orig && dest ? `${orig} → ${dest}` : "Train",
      subtitle: joinDot(f["Train Number"], f["Class"]) || null,
      location: text(f["Origin Station"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Guest"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Train #", text(f["Train Number"])],
          ["Class", text(f["Class"])],
          ["Carriage / seat", joinDot(f["Carriage"], f["Seat"])],
          ["Departs", joinDot(whenStr(f["Departure Date"], f["Departure Time"]), text(f["Origin Station"]))],
          ["Arrives", joinDot(whenStr(f["Arrival Date"], f["Arrival Time"]), text(f["Destination Station"]))],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Luxury trains ───────────────────────────────────────────────────────────
type LuxuryTrainRow = { id: string; fields: Record<string, unknown> };
const loadLuxuryTrains: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<LuxuryTrainRow>("tbllhj4Z4D2mNDg0M", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Boarding Date"], f["Boarding Time"]);
    if (!tripId || !startAt) continue;
    const cur = text(f["Currency"]) ?? "USD";
    out.push({
      id: `luxury_train-${row.id}`,
      category: "luxury_train",
      startAt,
      endAt: combineDateTime(f["Disembarking Date"], f["Disembarking Time"]),
      title: text(f["Train Name"]) ?? "Luxury train",
      subtitle: joinDot(f["Itinerary Name"], f["Cabin Category"]) || null,
      location: text(f["Origin Station"]) ?? text(f["Origin City"]),
      guests: resolveGuestNames(guests, f["Guest"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: costLines(
          ["Cabin rate", f["Cabin Rate"], cur],
          ["Deposit", f["Deposit Amount"], cur],
        ),
        details: detailsOf(
          ["Train", text(f["Train Name"])],
          ["Itinerary", text(f["Itinerary Name"])],
          ["Operator", text(f["Operator"])],
          ["Cabin", joinDot(f["Cabin Category"], f["Cabin Number"])],
          ["Boards", joinDot(whenStr(f["Boarding Date"], f["Boarding Time"]), text(f["Origin Station"]))],
          ["Disembarks", joinDot(whenStr(f["Disembarking Date"], f["Disembarking Time"]), text(f["Destination Station"]))],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Cancellation policy", text(f["Cancellation Policy"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Yacht charters ──────────────────────────────────────────────────────────
type YachtCharterRow = { id: string; fields: Record<string, unknown> };
const loadYachtCharters: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<YachtCharterRow>("tblzaTuqLXD6use0q", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Embark Date"], f["Embark Time"]);
    if (!tripId || !startAt) continue;
    out.push({
      id: `yacht_charter-${row.id}`,
      category: "yacht_charter",
      startAt,
      endAt: combineDateTime(f["Disembark Date"], f["Disembark Time"]),
      title: text(f["Yacht Name"]) ?? "Yacht charter",
      subtitle: joinDot(f["Charter Company"], f["Vessel Length"]) || null,
      location: text(f["Embark Port"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Yacht", text(f["Yacht Name"])],
          ["Charter company", text(f["Charter Company"])],
          ["Captain", text(f["Captain Name"])],
          ["Embarks", joinDot(whenStr(f["Embark Date"], f["Embark Time"]), text(f["Embark Port"]))],
          ["Disembarks", joinDot(whenStr(f["Disembark Date"], f["Disembark Time"]), text(f["Disembark Port"]))],
          ["Crew size", f["Crew Size"]],
          ["Itinerary", text(f["Itinerary"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// ── Short-term yacht hires ──────────────────────────────────────────────────
type ShortYachtRow = { id: string; fields: Record<string, unknown> };
const loadShortYachts: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<ShortYachtRow>("tbln4NAu4FZb0hy7a", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Charter Start Date"], f["Charter Start Time"]);
    if (!tripId || !startAt) continue;
    out.push({
      id: `yacht_short-${row.id}`,
      category: "yacht_short",
      startAt,
      endAt: combineDateTime(f["Charter End Date"], f["Charter End Time"]),
      title: text(f["Yacht Name"]) ?? "Yacht hire",
      subtitle: joinDot(f["Provider"], f["Duration"]) || null,
      location: text(f["Embark Port"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation Number"]),
      admin: {
        cost: [],
        details: detailsOf(
          ["Yacht", text(f["Yacht Name"])],
          ["Provider", text(f["Provider"])],
          ["Captain", text(f["Captain Name"])],
          ["Duration", text(f["Duration"])],
          ["Starts", joinDot(whenStr(f["Charter Start Date"], f["Charter Start Time"]), text(f["Embark Port"]))],
          ["Ends", whenStr(f["Charter End Date"], f["Charter End Time"])],
          ["Confirmation #", text(f["Confirmation Number"])],
          ["Notes", text(f["Notes"])],
        ),
      },
      _tripRecordId: tripId,
    });
  }
  return out;
};

// Every category loader. Add a new booking type here and it joins the itinerary.
const CATEGORY_LOADERS: Loader[] = [
  loadFlights,
  loadHotels,
  loadVillas,
  loadCars,
  loadRestaurants,
  loadActivities,
  loadGreeters,
  loadCruises,
  loadPrivateFlights,
  loadRentalCars,
  loadHelicopters,
  loadVipTerminals,
  loadVipEvents,
  loadTrains,
  loadLuxuryTrains,
  loadYachtCharters,
  loadShortYachts,
];

// Reservations for ONE trip. Each category is fetched server-side filtered to
// the trip (a handful of rows, ~1 page each) and run in parallel, so this is a
// small, fast fan-out — not a load of every booking across every trip.
async function loadReservationsForTrip(
  guests: Map<string, string>,
  tripCode: string,
): Promise<Reservation[]> {
  if (!TOKEN) return [];
  const byCategory = await Promise.all(
    CATEGORY_LOADERS.map((load) =>
      load(guests, tripCode).catch((err) => {
        console.warn("category loader failed (skipped):", err);
        return [] as Reservation[];
      }),
    ),
  );
  return byCategory.flat();
}

// ---------------------------------------------------------------------------
// Day grouping
// ---------------------------------------------------------------------------

function enumerateDays(start: string, end: string): string[] {
  const lo = new Date(start + "T00:00:00Z").getTime();
  const hi = new Date(end + "T00:00:00Z").getTime();
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
  if ((hi - lo) / 86_400_000 > 120) return []; // guard against bad data
  const out: string[] = [];
  for (let t = lo; t <= hi; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function buildItinerary(
  trip: TripAirtableRow,
  reservations: Reservation[],
  guests: Map<string, string>,
): ItineraryDetail {
  const f = trip.fields;
  const tripCode = f["Trip ID"] ?? trip.id;
  const startDate = f["Trip Start Date"] ?? "";
  const endDate = f["Trip End Date"] ?? "";

  const guestList: ItineraryDetail["guests"] = [
    ...resolveGuestNames(guests, f["Lead Guest"]).map((name) => ({ name, role: "lead" as const })),
    ...resolveGuestNames(guests, f["Companions"]).map((name) => ({ name, role: "guest" as const })),
  ];

  const byDay = new Map<string, Reservation[]>();
  for (const r of reservations) {
    const day = r.startAt.slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r);
  }
  for (const arr of byDay.values()) arr.sort((a, b) => a.startAt.localeCompare(b.startAt));

  // Continuous day list spanning the trip (widened to cover any stray booking),
  // so empty days still render. Falls back to booked days if dates are missing.
  const booked = [...byDay.keys()].sort();
  const dates =
    startDate && endDate
      ? enumerateDays(
          [startDate, ...booked].sort()[0],
          [endDate, ...booked].sort().slice(-1)[0],
        )
      : booked;
  const dayList = dates.length ? dates : booked;

  const days: ItineraryDay[] = dayList.map((date) => ({
    date,
    reservations: (byDay.get(date) ?? []).map(({ _tripRecordId, ...r }) => r as Reservation),
  }));

  const totalsMap = new Map<string, number>();
  for (const r of reservations)
    for (const c of r.admin.cost) totalsMap.set(c.currency, (totalsMap.get(c.currency) ?? 0) + c.amount);

  return {
    tripCode,
    tripRecordId: trip.id,
    name: f["Internal Trip Name"] ?? f["External Trip Name"] ?? tripCode,
    startDate,
    endDate,
    status: f["Status"] ?? null,
    guests: guestList,
    days,
    totals: [...totalsMap.entries()].map(([currency, amount]) => ({ currency, amount })),
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Full admin itinerary for one trip code (e.g. "TR00000001"), or undefined. */
export async function loadItinerary(tripCode: string): Promise<ItineraryDetail | undefined> {
  const [trips, guests] = await Promise.all([loadTripRows(), loadGuestsMap()]);
  const trip = trips.find((t) => (t.fields["Trip ID"] ?? t.id) === tripCode);
  if (!trip) return undefined;
  const reservations = await loadReservationsForTrip(guests, tripCode);
  return buildItinerary(trip, reservations, guests);
}
