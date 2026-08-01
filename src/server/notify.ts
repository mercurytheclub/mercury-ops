import "server-only";

// Team WhatsApp notifications — mirrors the n8n booking forms so the same groups
// get the same "New / Updated booking" messages when ops saves a booking. Each
// booking type posts to its own group with its own format.
//
// SENDS THROUGH THE MERCURY OPS RELAY, NOT whapi directly.
//
// Until 2026-08-01 this posted straight to gate.whapi.cloud, which made it the
// last sender in the estate invisible to the ⚙️ Ops Outbox — every one of the 64
// n8n workflows had been migrated and this one was missed, because it is the only
// sender that is not an n8n node. Going through the relay means:
//
//   • every notification is written to Airtable BEFORE it is sent, so a WhatsApp
//     outage leaves a durable record of what ops saved but the team never saw;
//   • the whapi token is no longer needed here at all — it lives only on the
//     relay, so this app cannot leak it and cannot reach the /groups endpoint
//     that got the number banned on 2026-07-29;
//   • the relay returns a REAL delivery verdict, so a failure can be logged
//     instead of silently discarded as it was before.
//
// Fire-and-forget semantics are unchanged: a send failure must NEVER break a
// save (matches the n8n `continueOnFail`). Group ids stay here so the routing is
// visible, and the message bodies are untouched.

import type { BookingType } from "@/lib/bookingFields";
import type { BookingValues } from "./bookings";

const RELAY_URL = "https://mercury-server.fly.dev/internal/ops/messages/text";
/** Transport guard on every /internal route. */
const MERCURY_APP_KEY = process.env.MERCURY_APP_KEY;
/** The relay route's own shared secret. */
const OPS_RELAY_SECRET = process.env.OPS_RELAY_SECRET;

/**
 * Bounded, because `notifyTeam` is awaited inside the save action — an
 * unbounded fetch (what this used to do) leaves an ops user watching a spinner
 * for as long as the upstream hangs.
 *
 * Cutting the relay off client-side is safe in a way it was not before: the
 * relay writes the outbox row BEFORE attempting the send, so an aborted request
 * still leaves a durable record and the send still completes server-side. The
 * worst case is a row we did not read the verdict for, not a lost notification.
 */
const SEND_TIMEOUT_MS = 10_000;

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

/** Notify the type's team WhatsApp group through the Ops Relay. No-ops when the
 *  relay credentials are unset. */
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
  if (!MERCURY_APP_KEY || !OPS_RELAY_SECRET) {
    // Not configured (e.g. local dev) — don't send, but log the would-be
    // message so the format can be verified without pinging the team groups.
    // BOTH are required: the relay is behind the transport guard AND its own
    // shared secret, so half a config is not a working config.
    console.log(
      `[notify] relay credentials unset (need MERCURY_APP_KEY + OPS_RELAY_SECRET) — ` +
        `would send to ${GROUP[input.type]}:\n${body}`,
    );
    return;
  }
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: {
        "x-mercury-key": MERCURY_APP_KEY,
        "x-internal-secret": OPS_RELAY_SECRET,
        // Becomes the outbox row's Source, so "which sender stopped working"
        // is answerable from the table during an outage.
        "x-ops-source": "mercury-ops (booking saved)",
        "content-type": "application/json",
      },
      // The wire body is whapi's own shape and is forwarded verbatim, so the
      // message the team receives is byte-for-byte what it was before.
      body: JSON.stringify({ to: GROUP[input.type], body }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The relay answers with the truth about delivery rather than a blanket
      // 200, so this is worth surfacing — the old code discarded it entirely.
      // The booking is already saved; this only means the group was not told.
      console.warn(
        `[notify] relay reported NOT delivered (${res.status}) for ${input.type} — ` +
          `the booking is saved but the group was not notified. ` +
          `The full message is in the ⚙️ Ops Outbox table.`,
      );
    }
  } catch (err) {
    console.warn("[notify] relay send failed (non-fatal):", err);
  }
}
