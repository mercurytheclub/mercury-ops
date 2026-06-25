import "server-only";

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

export type Category = "flight" | "hotel" | "car" | "restaurant" | "activity" | "villa";

export type CostLine = { label: string; amount: number; currency: string };

/** Internal, ops-only block. Never shown in the guest app. */
export type AdminBlock = {
  cost: CostLine[];
  supplier: string | null;
  /** Driver/operator contact — name and/or phone. */
  contact: string | null;
  /** PNR / record locator / ticket / confirmation that's internal-leaning. */
  locator: string | null;
  notes: string | null;
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

/** A category loader: reservations for ONE trip (filtered server-side by Trip ID). */
type Loader = (guests: Map<string, string>, tripCode: string) => Promise<Reservation[]>;

// Booking rows often leave the denormalized name text blank, carrying only a
// link to the master row. Resolve id → primary-field name so titles are never
// generic ("Hotel"). One cached map per master table.
type NameRow = { id: string; fields: Record<string, unknown> };
function nameMapLoader(tableId: string, primaryField: string) {
  return makeCached(async () => {
    const map = new Map<string, string>();
    if (!TOKEN) return map;
    for (const row of await fetchAllPages<NameRow>(tableId)) {
      const name = row.fields[primaryField];
      if (typeof name === "string" && name.trim()) map.set(row.id, name.trim());
    }
    return map;
  });
}

const loadHotelNames = nameMapLoader("tblPnBimrs9eLjooQ", "Hotel Name");
const loadRestaurantNames = nameMapLoader("tblxpKxRFuytOAawA", "Restaurant Name");
const loadActivityNames = nameMapLoader("tblawM4QCpAm01P8w", "Activity Name");

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
    "Seat Assignment"?: string;
    "Record Locator"?: string;
    "GDS PNR"?: string;
    "Ticket Number"?: string;
    "Ticket Cost"?: number;
    "Taxes & Fees"?: number;
    "Net Cost (Internal Only)"?: number;
    "Total Fare"?: number;
    "Status"?: string;
    "Dummy Flight"?: boolean;
  };
};

const loadFlights: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<FlightRow>("tblElrgipumvI2yna", tripFilter(tripCode));
  const byKey = new Map<string, Reservation>();
  for (const row of rows) {
    const f = row.fields;
    if (f["Dummy Flight"] || isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Flight Departure Date"], f["Flight Departure Time"]);
    if (!tripId || !startAt) continue;
    const flightNo = f["Flight Number"] ?? "—";
    const key = `${tripId}|${flightNo}|${startAt.slice(0, 10)}`;
    const guestNames = resolveGuestNames(guests, f["Guest"]);
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
            ["Net cost (internal)", f["Net Cost (Internal Only)"]],
          ),
          supplier: null,
          contact: null,
          locator: text(f["Record Locator"]) ?? text(f["GDS PNR"]) ?? text(f["Ticket Number"]),
          notes: f["Seat Assignment"] ? `Seat ${f["Seat Assignment"]}` : null,
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
    "Confirmation Number"?: string;
    "Booking Currency"?: string;
    "BC - Grand Total"?: number;
    "GPC - Grand Total"?: number;
    "Pre-Tax Subtotal"?: number;
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
        ),
        supplier: hotelName,
        contact: null,
        locator: text(f["Confirmation Number"]),
        notes: text(f["Cancellation Policy"]),
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
    "Check In Date"?: string;
    "Check Out Date"?: string;
    "Confirmation Number"?: string;
    "Currency"?: string;
    "Base Nightly Rate"?: number;
    "Pre-Tax Subtotal"?: number;
    "Grand Total"?: number;
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
        supplier: text(f["Property Name"]),
        contact: null,
        locator: text(f["Confirmation Number"]),
        notes: text(f["Check-in Instructions"]) ?? text(f["Cancellation Policy"]),
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
    "Service Type"?: string[];
    "Vehicle Type"?: string;
    "Supplier"?: string;
    "Confirmation #"?: string;
    "Driver Name"?: string;
    "Driver Phone"?: string;
    "Pick Up Address"?: string;
    "Pick Up (Short)"?: string;
    "Drop Off (Short)"?: string;
    "Pick Up Date"?: string;
    "Pick Up Time"?: string;
    "Drop Off Date"?: string;
    "Drop Off Time"?: string;
    "Status"?: string;
    "Trip ID"?: LinkedRecord[];
    "Lead Guest"?: LinkedRecord[];
    "Companions"?: LinkedRecord[];
  };
};

const loadCars: Loader = async (guests, tripCode) => {
  const rows = await fetchAllPages<CarRow>("tblDLF5H4wuOmrAPq", tripFilter(tripCode));
  const out: Reservation[] = [];
  for (const row of rows) {
    const f = row.fields;
    if (isCancelled(f["Status"])) continue;
    const tripId = linkedIds(f["Trip ID"])[0];
    const startAt = combineDateTime(f["Pick Up Date"], f["Pick Up Time"]);
    if (!tripId || !startAt) continue;
    const route = [text(f["Pick Up (Short)"]), text(f["Drop Off (Short)"])].filter(Boolean);
    out.push({
      id: `car-${row.id}`,
      category: "car",
      startAt,
      endAt: combineDateTime(f["Drop Off Date"], f["Drop Off Time"]),
      title: route.length ? route.join(" → ") : text(f["Vehicle Type"]) ?? "Car service",
      subtitle: (f["Service Type"] ?? []).join(" · ") || text(f["Vehicle Type"]),
      location: text(f["Pick Up Address"]),
      guests: resolveGuestNames(guests, f["Lead Guest"], f["Companions"]),
      confirmation: text(f["Confirmation #"]),
      admin: {
        cost: [],
        supplier: text(f["Supplier"]),
        contact: contactOf(f["Driver Name"], f["Driver Phone"]),
        locator: text(f["Confirmation #"]),
        notes: null,
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
        supplier: name,
        contact: null,
        locator: text(f["Confirmation Number"]),
        notes: text(f["Notes"]),
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
    "Contact Name"?: string;
    "Contact Phone"?: string;
    "Status"?: string;
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
        supplier: text(f["Operator"]),
        contact: contactOf(f["Contact Name"], f["Contact Phone"]),
        locator: text(f["Confirmation Number"]),
        notes: text(f["Notes"]) ?? text(f["Description"]),
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
    name: f["External Trip Name"] ?? tripCode,
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
