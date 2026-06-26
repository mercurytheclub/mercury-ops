import "server-only";

// Team WhatsApp notifications via Whapi — mirrors the n8n booking forms so the
// same groups get the same "New / Updated booking" messages when ops saves a
// booking. Each booking type posts to its own group with its own format.
//
// Fire-and-forget: a Whapi failure must NEVER break a save (matches the n8n
// `continueOnFail`). The token is an env secret; group ids are public-ish
// identifiers kept here so the routing is visible.

import type { BookingType } from "@/lib/bookingFields";
import type { BookingValues } from "./bookings";

const WHAPI_URL = "https://gate.whapi.cloud/messages/text";
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

const GROUP: Record<BookingType, string> = {
  restaurant: "120363427918542961@g.us",
  activity: "120363427995792106@g.us",
  greeter: "120363423696228044@g.us",
  car: "120363411026604887@g.us",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d: string): string {
  const s = (d || "").split("-");
  if (s.length !== 3) return d || "";
  const m = MONTHS[parseInt(s[1], 10) - 1];
  return m ? `${m} ${parseInt(s[2], 10)}, ${s[0]}` : d;
}

const VEHICLES = ["Sedan", "SUV", "Sprinter Van", "Viano", "Hi-Ace", "Alphard", "Luggage Van"];

type Ctx = { tripName?: string; submittedBy?: string };

function str(v: BookingValues, k: string): string {
  const x = v[k];
  return typeof x === "string" ? x.trim() : "";
}
function arr(v: BookingValues, k: string): string[] {
  const x = v[k];
  return Array.isArray(x) ? x : [];
}

// Build the per-type message body, matching the n8n form formats exactly.
function buildMessage(type: BookingType, isEdit: boolean, v: BookingValues, ctx: Ctx): string {
  const by = ctx.submittedBy || "Mercury Ops";
  const trip = ctx.tripName || "";

  if (type === "restaurant") {
    const name = str(v, "Restaurant Name");
    const cuisine = str(v, "Cuisine");
    const guest = [str(v, "Guest First Name"), str(v, "Guest Last Name")].filter(Boolean).join(" ");
    const lines = [`🍴 *${isEdit ? "Updated" : "New"} Restaurant Booking*`, ""];
    if (name) lines.push(`*Restaurant:* ${name}${cuisine ? ` (${cuisine})` : ""}`);
    if (str(v, "Reservation Date")) lines.push(`*Date:* ${fmtDate(str(v, "Reservation Date"))}`);
    if (str(v, "Reservation Time")) lines.push(`*Time:* ${str(v, "Reservation Time")}`);
    if (str(v, "Number of Guests")) lines.push(`*Guests:* ${str(v, "Number of Guests")}`);
    if (guest) lines.push(`*Guest:* ${guest}`);
    if (trip) lines.push(`*Trip:* 📍 ${trip}`);
    if (str(v, "Confirmation Number")) lines.push(`*Confirmation #:* ${str(v, "Confirmation Number")}`);
    if (str(v, "Address")) lines.push(`*Address:* ${str(v, "Address")}`);
    if (str(v, "Notes")) lines.push(`*Notes:* ${str(v, "Notes")}`);
    lines.push("", `_Submitted by ${by}_`);
    return lines.join("\n");
  }

  if (type === "activity") {
    const guest = [str(v, "Guest First Name"), str(v, "Guest Last Name")].filter(Boolean).join(" ");
    const lines = [`📌 *${isEdit ? "Updated" : "New"} Activity Booking*`, ""];
    if (str(v, "Activity Name")) lines.push(`*Activity:* ${str(v, "Activity Name")}`);
    if (str(v, "Duration")) lines.push(`*Duration:* ${str(v, "Duration")}`);
    if (str(v, "Operator")) lines.push(`*Operator:* ${str(v, "Operator")}`);
    if (str(v, "Activity Date")) lines.push(`*Date:* ${fmtDate(str(v, "Activity Date"))}`);
    if (str(v, "Activity Time")) lines.push(`*Time:* ${str(v, "Activity Time")}`);
    if (guest) lines.push(`*Guest:* ${guest}`);
    if (trip) lines.push(`*Trip:* ${trip}`);
    if (str(v, "Meeting Point")) lines.push(`*Meeting Point:* ${str(v, "Meeting Point")}`);
    if (str(v, "Confirmation Number")) lines.push(`*Confirmation #:* ${str(v, "Confirmation Number")}`);
    if (str(v, "Notes")) lines.push(`*Notes:* ${str(v, "Notes")}`);
    lines.push("", `_Submitted by ${by}_`);
    return lines.join("\n");
  }

  if (type === "greeter") {
    const guest = [str(v, "Guest First Name"), str(v, "Guest Last Name")].filter(Boolean).join(" ");
    const date = str(v, "Service Date");
    const time = str(v, "Service Time");
    const lines = [isEdit ? "*Greeter Booking Updated*" : "*New Greeter Booking Added*"];
    if (guest) lines.push(`Guest: ${guest}`);
    if (trip) lines.push(`Trip: ${trip}`);
    if (str(v, "Supplier")) lines.push(`Supplier: ${str(v, "Supplier")}`);
    if (str(v, "Service Type")) lines.push(`Service: ${str(v, "Service Type")}`);
    if (date || time) lines.push(`Date: ${date}${time ? ` at ${time}` : ""}`);
    if (str(v, "Associated Flight")) lines.push(`Flight: ${str(v, "Associated Flight")}`);
    if (str(v, "Confirmation #")) lines.push(`Confirmation #: ${str(v, "Confirmation #")}`);
    if (str(v, "PNR")) lines.push(`PNR: ${str(v, "PNR")}`);
    if (str(v, "Greeter Name")) lines.push(`Greeter: ${str(v, "Greeter Name")}`);
    if (str(v, "Greeter Phone")) lines.push(`Greeter Phone: ${str(v, "Greeter Phone")}`);
    if (str(v, "Notes")) lines.push(`Notes: ${str(v, "Notes")}`);
    lines.push("", `_Added manually by ${by}_`);
    return lines.join("\n");
  }

  // car
  const vehText = VEHICLES.filter((veh) => Number(str(v, veh)) > 0)
    .map((veh) => `${str(v, veh)}x ${veh}`)
    .join(", ");
  const lines = [`🚗 *Car Service booking ${isEdit ? "updated" : "logged"}*`, ""];
  if (trip) lines.push(`🧳 ${trip}`);
  const stypes = arr(v, "Service Type").join(", ");
  if (stypes) lines.push(`🏷️ ${stypes}`);
  if (str(v, "Supplier")) lines.push(`🏢 ${str(v, "Supplier")}`);
  if (str(v, "Confirmation #")) lines.push(`🔖 Conf #: ${str(v, "Confirmation #")}`);
  const pu = [fmtDate(str(v, "Pick Up Date")), str(v, "Pick Up Time")].filter(Boolean).join(" ");
  if (pu || str(v, "Pick Up Address")) lines.push(`📍 Pick Up: ${[pu, str(v, "Pick Up Address")].filter(Boolean).join(" — ")}`);
  const drop = [fmtDate(str(v, "Drop Off Date")), str(v, "Drop Off Time")].filter(Boolean).join(" ");
  if (drop || str(v, "Drop Off Address")) lines.push(`🏁 Drop Off: ${[drop, str(v, "Drop Off Address")].filter(Boolean).join(" — ")}`);
  const driver = [str(v, "Driver Name"), str(v, "Driver Phone")].filter(Boolean).join(" ");
  if (driver) lines.push(`🚙 Driver: ${driver}`);
  if (vehText) lines.push(`🚐 ${vehText}`);
  if (str(v, "Duration")) lines.push(`⏱️ ${str(v, "Duration")}`);
  lines.push("", `_Logged by ${by}_`);
  return lines.join("\n");
}

/** Build the team message for a saved booking — exported for local format checks. */
export function bookingMessage(type: BookingType, isEdit: boolean, values: BookingValues, ctx: Ctx = {}): string {
  return buildMessage(type, isEdit, values, ctx);
}

/** Notify the type's team WhatsApp group. No-ops if WHAPI_TOKEN is unset. */
export async function notifyTeam(input: {
  type: BookingType;
  isEdit: boolean;
  values: BookingValues;
  tripName?: string;
  submittedBy?: string;
}): Promise<void> {
  const body = buildMessage(input.type, input.isEdit, input.values, {
    tripName: input.tripName,
    submittedBy: input.submittedBy,
  });
  if (!WHAPI_TOKEN) {
    // Not configured (e.g. local dev) — don't send, but log the would-be
    // message so the format can be verified without pinging the team groups.
    console.log(`[notify] WHAPI_TOKEN unset — would send to ${GROUP[input.type]}:\n${body}`);
    return;
  }
  try {
    await fetch(WHAPI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHAPI_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ to: GROUP[input.type], body }),
    });
  } catch (err) {
    console.warn("whapi notify failed (non-fatal):", err);
  }
}
