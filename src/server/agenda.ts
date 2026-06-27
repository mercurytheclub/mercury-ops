import "server-only";

// Cross-trip operational agenda — the "command center" lens. Instead of one
// trip's bookings, this asks: what is happening on these DAYS, across EVERY
// trip? Each booking table is queried by its date field within the window, then
// flattened into time-sorted day buckets with trip + guest context.

import {
  TOKEN,
  fetchAllPages,
  combineDateTime,
  linkedIds,
  loadGuestsMap,
  loadTripRows,
  resolveGuestNames,
} from "./airtable";
import type { Category } from "./itinerary";

export type AgendaItem = {
  id: string;
  category: Category;
  label: string;
  startAt: string; // floating ISO — sorts the day
  time: string | null;
  title: string;
  tripCode: string;
  tripName: string;
  guest: string | null;
};

export type AgendaDay = { date: string; items: AgendaItem[] };

type AnyRow = { id: string; fields: Record<string, unknown> };

// One operational source per booking category: where its primary "moment" lives.
type Source = {
  category: Category;
  label: string;
  tableId: string;
  dateField: string;
  timeField?: string;
  /** Name-based title field, OR a [origin, destination] route pair. */
  titleField?: string;
  route?: [string, string];
  /** Guest link fields to resolve a primary guest name from. */
  guestFields: string[];
};

const SOURCES: Source[] = [
  { category: "flight", label: "FLIGHT", tableId: "tblElrgipumvI2yna", dateField: "Flight Departure Date", timeField: "Flight Departure Time", route: ["Departure Airport Code", "Arrival Airport Code"], guestFields: ["Guest"] },
  { category: "private_flight", label: "PRIVATE FLIGHT", tableId: "tblD1G2s21Nv4HbNG", dateField: "Flight Departure Date", timeField: "Flight Departure Time", route: ["Departure Airport", "Arrival Airport"], guestFields: ["Lead Guest", "Companions"] },
  { category: "helicopter", label: "HELICOPTER", tableId: "tblZnCNZtkamdc3ET", dateField: "Flight Departure Date", timeField: "Flight Departure Time", route: ["Origin Helipad", "Destination Helipad"], guestFields: ["Lead Guest"] },
  { category: "hotel", label: "HOTEL CHECK-IN", tableId: "tblZeoVNQyq2wWUtV", dateField: "Check In Date", timeField: "Check In Time", titleField: "Hotel Name", guestFields: ["Lead Guest", "Guest"] },
  { category: "villa", label: "VILLA CHECK-IN", tableId: "tblNwLeS5fuj3qulQ", dateField: "Check In Date", titleField: "Property Name", guestFields: ["Lead Guest"] },
  { category: "car", label: "CAR SERVICE", tableId: "tblDLF5H4wuOmrAPq", dateField: "Pick Up Date", timeField: "Pick Up Time", route: ["Pick Up (Short)", "Drop Off (Short)"], guestFields: ["Lead Guest"] },
  { category: "rental_car", label: "RENTAL CAR", tableId: "tblC5IJe3DtPVqyP6", dateField: "Pick Up Date", timeField: "Pick Up Time", titleField: "Rental Company", guestFields: ["Lead Guest"] },
  { category: "restaurant", label: "RESTAURANT", tableId: "tbl4o7RIr37vo8Uj5", dateField: "Reservation Date", timeField: "Reservation Time", titleField: "Restaurant Name", guestFields: ["Lead Guest"] },
  { category: "activity", label: "ACTIVITY", tableId: "tbli8AU5hA12ROjmi", dateField: "Activity Date", timeField: "Activity Time", titleField: "Activity Name", guestFields: ["Lead Guest"] },
  { category: "greeter", label: "AIRPORT GREETER", tableId: "tblLS8Qc9xarbvtW4", dateField: "Service Date", timeField: "Service Time", titleField: "Supplier", guestFields: ["Lead Guest"] },
  { category: "vip_terminal", label: "VIP TERMINAL", tableId: "tblQrwjoxgum85bY2", dateField: "Service Date", timeField: "Service Time", titleField: "Airport", guestFields: ["Lead Guest"] },
  { category: "vip_event", label: "VIP EVENT", tableId: "tblRuveDqzottMIyd", dateField: "Event Start Date", timeField: "Event Start Time", titleField: "Event Name", guestFields: ["Guest"] },
  { category: "cruise", label: "CRUISE", tableId: "tblli9V6EUPLr2Acb", dateField: "Sailing Date", timeField: "Embarkation Start Time", titleField: "Ship Name", guestFields: ["Guest"] },
  { category: "train", label: "TRAIN", tableId: "tbll8JRoErHvAfdPm", dateField: "Departure Date", timeField: "Departure Time", route: ["Origin Station", "Destination Station"], guestFields: ["Lead Guest", "Guest"] },
  { category: "luxury_train", label: "LUXURY TRAIN", tableId: "tbllhj4Z4D2mNDg0M", dateField: "Boarding Date", timeField: "Boarding Time", titleField: "Train Name", guestFields: ["Guest"] },
  { category: "yacht_charter", label: "YACHT CHARTER", tableId: "tblzaTuqLXD6use0q", dateField: "Embark Date", timeField: "Embark Time", titleField: "Yacht Name", guestFields: ["Lead Guest"] },
  { category: "yacht_short", label: "YACHT HIRE", tableId: "tbln4NAu4FZb0hy7a", dateField: "Charter Start Date", timeField: "Charter Start Time", titleField: "Yacht Name", guestFields: ["Lead Guest"] },
];

const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function addDays(isoDate: string, n: number): string {
  const t = new Date(isoDate + "T00:00:00Z").getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

async function loadSource(
  src: Source,
  fromMinus1: string,
  toPlus1: string,
  guests: Map<string, string>,
  tripById: Map<string, { code: string; name: string }>,
): Promise<AgendaItem[]> {
  // Date in (fromMinus1, toPlus1) == within [from, to] inclusive. Skip cancelled.
  const formula = `AND(IS_AFTER({${src.dateField}},'${fromMinus1}'),IS_BEFORE({${src.dateField}},'${toPlus1}'),NOT(FIND('ancel',{Status}&'')))`;
  const rows = await fetchAllPages<AnyRow>(src.tableId, formula);
  const out: AgendaItem[] = [];
  for (const r of rows) {
    const f = r.fields;
    if (f["Dummy Flight"] === true) continue;
    const startAt = combineDateTime(f[src.dateField], src.timeField ? f[src.timeField] : null);
    const tripId = linkedIds(f["Trip ID"])[0];
    if (!startAt || !tripId) continue;
    const trip = tripById.get(tripId);
    if (!trip) continue;

    let title: string;
    if (src.route) {
      const a = txt(f[src.route[0]]);
      const b = txt(f[src.route[1]]);
      title = a && b ? `${a} → ${b}` : a || b || src.label.toLowerCase();
    } else {
      title = txt(f[src.titleField ?? ""]) || src.label.toLowerCase();
    }

    out.push({
      id: `${src.category}-${r.id}`,
      category: src.category,
      label: src.label,
      startAt,
      time: src.timeField ? txt(f[src.timeField]) || null : null,
      title,
      tripCode: trip.code,
      tripName: trip.name,
      guest: resolveGuestNames(guests, ...src.guestFields.map((k) => f[k]))[0] ?? null,
    });
  }
  return out;
}

/** Operational items between two YYYY-MM-DD dates (inclusive), grouped by day. */
export async function loadAgenda(fromDate: string, toDate: string): Promise<AgendaDay[]> {
  if (!TOKEN) return [];
  const [guests, trips] = await Promise.all([loadGuestsMap(), loadTripRows()]);
  const tripById = new Map(
    trips.map((t) => [
      t.id,
      { code: (t.fields["Trip ID"] ?? t.id) as string, name: (t.fields["External Trip Name"] ?? t.fields["Trip ID"] ?? "trip") as string },
    ]),
  );

  const fromMinus1 = addDays(fromDate, -1);
  const toPlus1 = addDays(toDate, 1);
  const perSource = await Promise.all(
    SOURCES.map((src) =>
      loadSource(src, fromMinus1, toPlus1, guests, tripById).catch((err) => {
        console.warn(`agenda source ${src.category} failed:`, err);
        return [] as AgendaItem[];
      }),
    ),
  );

  const byDay = new Map<string, AgendaItem[]>();
  for (const item of perSource.flat()) {
    const day = item.startAt.slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(item);
  }
  return [...byDay.keys()]
    .sort()
    .map((date) => ({
      date,
      items: (byDay.get(date) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    }));
}
