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
  fields: FieldDef[];
};

const STATUS_ACTIVE_CANCELLED = ["Active", "Cancelled"];

export const BOOKING_CONFIG: Record<BookingType, BookingTypeConfig> = {
  restaurant: {
    type: "restaurant",
    label: "restaurant",
    tableId: "tbl4o7RIr37vo8Uj5",
    defaultStatus: { field: "Status", value: "Active" },
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
    fields: [
      { name: "Service Type", label: "Service type", kind: "multiselect", options: ["Airport Arrival", "Airport Departure", "Train Station Arrival", "Train Station Departure", "Point to Point", "Hourly (At Disposal)"] },
      { name: "Supplier", label: "Supplier", kind: "text", placeholder: "e.g. Blacklane, Empire CLS, local DMC…" },
      { name: "Confirmation #", label: "Confirmation #", kind: "text", half: true, placeholder: "Supplier reference" },
      { name: "Status", label: "Active / cancelled / on request", kind: "select", half: true, options: ["Active", "Cancelled", "On Request"] },
      { name: "Pick Up Address", label: "Pick-up address", kind: "text", placeholder: "Address / location" },
      { name: "Pick Up Date", label: "Pick-up date", kind: "date", half: true },
      { name: "Pick Up Time", label: "Pick-up time", kind: "time", half: true, placeholder: "e.g. 9:00 AM" },
      { name: "Drop Off Address", label: "Drop-off address", kind: "text", placeholder: "Address / location" },
      { name: "Drop Off Date", label: "Drop-off date", kind: "date", half: true },
      { name: "Drop Off Time", label: "Drop-off time", kind: "time", half: true, placeholder: "e.g. 11:00 AM" },
      { name: "Duration", label: "Duration", kind: "text", half: true, placeholder: "e.g. 4 hours" },
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
