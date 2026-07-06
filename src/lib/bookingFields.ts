// Shared booking field config — the single source of truth for what each
// editable booking type looks like in the ops drawer. Plain data (no server /
// client boundary) so both the server write layer and the client form import it.
//
// Each field maps directly to an Airtable field NAME on its table. Linked-record
// fields (Trip, Lead Guest, masters) are NOT edited here — a booking is created
// against a trip and carries denormalized guest-name text; relinking happens in
// Airtable. Keep field names EXACT — they're the Airtable column names.

export type BookingType = "restaurant" | "activity" | "car" | "greeter";

export type FieldKind =
  | "text"
  | "textarea"
  | "date"
  | "time" // free text ("7:00 PM" / "14:30") — preserves existing formats
  | "number"
  | "phone"
  | "email"
  | "select"
  | "multiselect";

export type FieldDef = {
  /** Exact Airtable field name. */
  name: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
  /** Render at half width (pairs two fields on one row on wide screens). */
  half?: boolean;
};

export type BookingTypeConfig = {
  type: BookingType;
  label: string; // singular, lowercase-friendly (rendered as a mono label upstream)
  tableId: string;
  /** Default Status applied to newly created records. */
  defaultStatus?: { field: string; value: string };
  /** Fields used to search + place an EXISTING booking when linking it to a trip. */
  link: { titleField: string; dateField: string; timeField?: string };
  fields: FieldDef[];
};

const STATUS_ACTIVE_CANCELLED = ["Active", "Cancelled"];
// Car Service Pickup/Drop-off Type — mirrors the table's single-select options.
const CAR_ENDPOINT_TYPES = ["Airport", "Train Station", "Hotel", "Villa", "Cruise Port", "Heliport", "Home Residence", "Yacht Anchorage", "Restaurant", "Activity", "Other"];

export const BOOKING_CONFIG: Record<BookingType, BookingTypeConfig> = {
  restaurant: {
    type: "restaurant",
    label: "restaurant",
    tableId: "tbl4o7RIr37vo8Uj5",
    defaultStatus: { field: "Status", value: "Active" },
    link: { titleField: "Restaurant Name", dateField: "Reservation Date", timeField: "Reservation Time" },
    fields: [
      { name: "Restaurant Name", label: "Restaurant", kind: "text", placeholder: "e.g. Le Bernardin" },
      { name: "Cuisine", label: "Cuisine", kind: "text", half: true, placeholder: "e.g. French" },
      { name: "Reservation Date", label: "Date", kind: "date", half: true },
      { name: "Reservation Time", label: "Time", kind: "time", half: true, placeholder: "e.g. 7:00 PM" },
      { name: "Number of Guests", label: "Party size", kind: "number", half: true, placeholder: "4" },
      { name: "Address", label: "Address", kind: "text", placeholder: "Address / location" },
      { name: "Guest First Name", label: "Guest first name", kind: "text", half: true },
      { name: "Guest Last Name", label: "Guest last name", kind: "text", half: true },
      { name: "Confirmation Number", label: "Confirmation #", kind: "text", half: true, placeholder: "e.g. RES-123456" },
      { name: "Distance", label: "Distance", kind: "text", half: true, placeholder: "e.g. 10 min from hotel" },
      { name: "Status Detail", label: "Booking status", kind: "select", half: true, options: ["Confirmed", "On Request"] },
      { name: "Status", label: "Active / cancelled", kind: "select", half: true, options: STATUS_ACTIVE_CANCELLED },
      { name: "Notes", label: "Notes", kind: "textarea", placeholder: "Anything the team should know…" },
    ],
  },

  activity: {
    type: "activity",
    label: "activity",
    tableId: "tbli8AU5hA12ROjmi",
    defaultStatus: { field: "Status", value: "Active" },
    link: { titleField: "Activity Name", dateField: "Activity Date", timeField: "Activity Time" },
    fields: [
      { name: "Activity Name", label: "Activity", kind: "text", placeholder: "e.g. Private Acropolis Tour" },
      { name: "Activity Date", label: "Date", kind: "date", half: true },
      { name: "Activity Time", label: "Start time", kind: "time", half: true, placeholder: "e.g. 9:00 AM" },
      { name: "End Time", label: "End time", kind: "time", half: true, placeholder: "e.g. 12:00 PM" },
      { name: "Duration", label: "Duration", kind: "text", half: true, placeholder: "e.g. 3 hours" },
      { name: "Meeting Point", label: "Meeting point", kind: "text", placeholder: "e.g. Hotel lobby" },
      { name: "Operator", label: "Operator", kind: "text", half: true, placeholder: "e.g. Local DMC" },
      { name: "Confirmation Number", label: "Confirmation #", kind: "text", half: true, placeholder: "e.g. ACT-123456" },
      { name: "Contact Name", label: "Contact name", kind: "text", half: true },
      { name: "Contact Phone", label: "Contact phone", kind: "phone", half: true },
      { name: "Guest First Name", label: "Guest first name", kind: "text", half: true },
      { name: "Guest Last Name", label: "Guest last name", kind: "text", half: true },
      { name: "Status", label: "Active / cancelled", kind: "select", half: true, options: STATUS_ACTIVE_CANCELLED },
      { name: "Description", label: "Description", kind: "textarea", placeholder: "What the activity includes…" },
      { name: "Notes", label: "Notes", kind: "textarea", placeholder: "Internal notes…" },
    ],
  },

  car: {
    type: "car",
    label: "car service",
    tableId: "tblDLF5H4wuOmrAPq",
    defaultStatus: { field: "Status", value: "Active" },
    link: { titleField: "Pickup (Short)", dateField: "Pickup Date", timeField: "Pickup Time" },
    fields: [
      // Service Mode replaces the deprecated "Service Type"; Pickup/Drop-off Type
      // describe the endpoints. Names + options match the Airtable table exactly.
      { name: "Service Mode", label: "Service mode", kind: "select", half: true, options: ["Transfer", "Hourly (At Disposal)"] },
      { name: "Status", label: "Active / on request / cancelled", kind: "select", half: true, options: ["Active", "On Request", "Modification Requested", "Cancelled"] },
      { name: "Pickup Type", label: "Pick-up type", kind: "select", half: true, options: CAR_ENDPOINT_TYPES },
      { name: "Drop-off Type", label: "Drop-off type", kind: "select", half: true, options: CAR_ENDPOINT_TYPES },
      { name: "Pickup Address", label: "Pick-up address", kind: "text", placeholder: "Address / location" },
      { name: "Pickup Date", label: "Pick-up date", kind: "date", half: true },
      { name: "Pickup Time", label: "Pick-up time", kind: "time", half: true, placeholder: "e.g. 9:00 AM" },
      { name: "Drop-off Address", label: "Drop-off address", kind: "text", placeholder: "Address / location" },
      { name: "Drop-off Date", label: "Drop-off date", kind: "date", half: true },
      { name: "Drop-off Time", label: "Drop-off time", kind: "time", half: true, placeholder: "e.g. 11:00 AM" },
      { name: "Duration", label: "Duration", kind: "text", half: true, placeholder: "e.g. 4 hours" },
      { name: "Confirmation #", label: "Confirmation #", kind: "text", half: true, placeholder: "Supplier reference" },
      { name: "Driver Name", label: "Driver name", kind: "text", half: true },
      { name: "Driver Phone", label: "Driver phone", kind: "phone", half: true },
      // Vehicle counts — compact number fields.
      { name: "Sedan", label: "Sedan", kind: "number", half: true, placeholder: "0" },
      { name: "SUV", label: "SUV", kind: "number", half: true, placeholder: "0" },
      { name: "Sprinter Van", label: "Sprinter van", kind: "number", half: true, placeholder: "0" },
      { name: "Viano", label: "Viano", kind: "number", half: true, placeholder: "0" },
      { name: "Hi-Ace", label: "Hi-Ace", kind: "number", half: true, placeholder: "0" },
      { name: "Alphard", label: "Alphard", kind: "number", half: true, placeholder: "0" },
      { name: "Luggage Van", label: "Luggage van", kind: "number", half: true, placeholder: "0" },
    ],
  },

  greeter: {
    type: "greeter",
    label: "airport greeter",
    tableId: "tblLS8Qc9xarbvtW4",
    defaultStatus: { field: "Status", value: "Active" },
    link: { titleField: "Supplier", dateField: "Service Date", timeField: "Service Time" },
    fields: [
      { name: "Service Type", label: "Service type", kind: "select", half: true, options: ["Arrival", "Departure", "Connection"] },
      { name: "Associated Flight", label: "Flight", kind: "text", half: true, placeholder: "e.g. AA123" },
      { name: "Service Date", label: "Date", kind: "date", half: true },
      { name: "Service Time", label: "Time", kind: "time", half: true, placeholder: "e.g. 14:30" },
      { name: "Supplier", label: "Supplier / company", kind: "text", placeholder: "e.g. VIP greeter company" },
      { name: "Greeter Name", label: "Greeter name", kind: "text", half: true },
      { name: "Greeter Phone", label: "Greeter phone", kind: "phone", half: true },
      { name: "Greeter Email", label: "Greeter email", kind: "email", half: true },
      { name: "Confirmation #", label: "Confirmation #", kind: "text", half: true, placeholder: "e.g. TX190875" },
      { name: "PNR", label: "PNR", kind: "text", half: true, placeholder: "e.g. GVFSZM" },
      { name: "Guest First Name", label: "Guest first name", kind: "text", half: true },
      { name: "Guest Last Name", label: "Guest last name", kind: "text", half: true },
      { name: "Status", label: "Active / cancelled", kind: "select", half: true, options: STATUS_ACTIVE_CANCELLED },
      { name: "Notes", label: "Notes", kind: "textarea", placeholder: "Internal notes…" },
    ],
  },
};

export const BOOKING_TYPES = Object.keys(BOOKING_CONFIG) as BookingType[];

// ───────────────────────────────────────────────────────────────────────────
// Linking existing bookings
// ───────────────────────────────────────────────────────────────────────────
// ANY booking type the itinerary renders as one-row-per-booking can be attached
// to a trip via the link picker — not just the four editable types. (Flights are
// excluded: they're one row per guest, so linking a single row would split the
// flight; that needs its own grouped flow.) Linking only needs lightweight
// metadata — a searchable title field + the date/time used to place it on a day.
export type LinkableType =
  | BookingType
  | "hotel"
  | "villa"
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

export type LinkMeta = {
  label: string;
  tableId: string;
  titleField: string;
  dateField: string;
  timeField?: string;
};

export const LINK_CONFIG: Record<LinkableType, LinkMeta> = {
  restaurant: { label: BOOKING_CONFIG.restaurant.label, tableId: BOOKING_CONFIG.restaurant.tableId, ...BOOKING_CONFIG.restaurant.link },
  activity: { label: BOOKING_CONFIG.activity.label, tableId: BOOKING_CONFIG.activity.tableId, ...BOOKING_CONFIG.activity.link },
  car: { label: BOOKING_CONFIG.car.label, tableId: BOOKING_CONFIG.car.tableId, ...BOOKING_CONFIG.car.link },
  greeter: { label: BOOKING_CONFIG.greeter.label, tableId: BOOKING_CONFIG.greeter.tableId, ...BOOKING_CONFIG.greeter.link },
  hotel: { label: "hotel", tableId: "tblZeoVNQyq2wWUtV", titleField: "Hotel Name", dateField: "Check In Date", timeField: "Check In Time" },
  villa: { label: "villa", tableId: "tblNwLeS5fuj3qulQ", titleField: "Property Name", dateField: "Check In Date" },
  cruise: { label: "cruise", tableId: "tblli9V6EUPLr2Acb", titleField: "Ship Name", dateField: "Sailing Date", timeField: "Embarkation Start Time" },
  private_flight: { label: "private flight", tableId: "tblD1G2s21Nv4HbNG", titleField: "Operator", dateField: "Flight Departure Date", timeField: "Flight Departure Time" },
  rental_car: { label: "rental car", tableId: "tblC5IJe3DtPVqyP6", titleField: "Rental Company", dateField: "Pick Up Date", timeField: "Pick Up Time" },
  helicopter: { label: "helicopter", tableId: "tblZnCNZtkamdc3ET", titleField: "Operator", dateField: "Flight Departure Date", timeField: "Flight Departure Time" },
  vip_terminal: { label: "VIP terminal", tableId: "tblQrwjoxgum85bY2", titleField: "Airport", dateField: "Service Date", timeField: "Service Time" },
  vip_event: { label: "VIP event", tableId: "tblRuveDqzottMIyd", titleField: "Event Name", dateField: "Event Start Date", timeField: "Event Start Time" },
  train: { label: "train", tableId: "tbll8JRoErHvAfdPm", titleField: "Origin Station", dateField: "Departure Date", timeField: "Departure Time" },
  luxury_train: { label: "luxury train", tableId: "tbllhj4Z4D2mNDg0M", titleField: "Train Name", dateField: "Boarding Date", timeField: "Boarding Time" },
  yacht_charter: { label: "yacht charter", tableId: "tblzaTuqLXD6use0q", titleField: "Yacht Name", dateField: "Embark Date", timeField: "Embark Time" },
  yacht_short: { label: "yacht hire", tableId: "tbln4NAu4FZb0hy7a", titleField: "Yacht Name", dateField: "Charter Start Date", timeField: "Charter Start Time" },
};

export const LINKABLE_TYPES = Object.keys(LINK_CONFIG) as LinkableType[];

/** Search hint per type — most search by name, greeter by supplier, car by pickup. */
export function linkSearchHint(type: LinkableType): string {
  if (type === "greeter") return "search by supplier…";
  if (type === "car") return "search by pick-up location…";
  return "search by name…";
}
