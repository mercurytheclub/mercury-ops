import "server-only";

// Concierge SMS — the ops side of the guest text line.
//
// Guests text Mercury's Twilio number. mercury-server owns everything that
// happens next: it matches the number to a guest, stores the message, nudges the
// ops WhatsApp group, and asks Claude for a reply draft. This file is the ops
// READ + SEND surface over the two Airtable tables that hold the result. It adds
// no new system of record — Airtable is still the record, and the Airtable
// interface keeps working alongside this.
//
// See mercury-consumer/docs/CONCIERGE_CHAT.md for the engine's own design notes.
// Two of its rules shape this file and must not be undone here:
//
//   • Claude never sends. The draft lands in a field; a concierge edits it and
//     presses send, and what goes out is whatever the field says at that moment.
//   • The send path claims before it sends (mercury-server unticks `Send` and
//     marks the row Queued BEFORE calling Twilio). That is what makes it safe
//     for this app and the existing Airtable automation to both fire on the same
//     row: whichever loses the race reads `Send` as false and refuses.
//
// FIELDS ARE ADDRESSED BY ID, NEVER BY NAME. Airtable renames dropped every
// flight on 2026-07-16 and 500'd every itinerary on 2026-07-26; the same rename
// here would silently read every thread as empty. `returnFieldsByFieldId=true`
// makes a rename a no-op. The one thing field ids cannot protect is
// `filterByFormula`, which can only reference names — so no read below filters
// on a field. Threads are read whole and filtered in memory (dozens of rows),
// and messages are addressed by `RECORD_ID()` alone.

import {
  BASE_ID,
  TOKEN,
  fetchAllPages,
  linkedIds,
  loadGuestsMap,
  loadTripRows,
  makeCached,
  timeframeOf,
} from "./airtable";
import { loadItinerary, type ItineraryDay } from "./itinerary";
import { unstable_cache } from "next/cache";

const THREADS_TABLE_ID = "tbl1TC0d6GyvPW61j"; // 💬 Concierge Threads
const MESSAGES_TABLE_ID = "tblpHhgvUfn49GcE0"; // 💬 Concierge Messages

/** 💬 Concierge Threads — one row per guest. */
const T = {
  thread: "fldwXHcVHr8apevaA",
  guest: "fldpyuWNbANkgjAI0",
  phone: "fldUbpGKQUPLoNiKn",
  status: "fldFHz7jSzXQQ9EtR",
  lastMessageAt: "fldeXLC9u1RkVH5gU",
  lastDirection: "fldRatezY5oi75sfu",
  unread: "fldkxovlW3gSshThy",
  optedOut: "fldYdgtqY6DtQM9wj",
  messages: "fldYIZqYLMcCJPXNE",
  // Added for this inbox. Not read or written by mercury-server, so a stale
  // claim can never block a send — it is a hint to the other concierge, not a
  // lock.
  claimedBy: "fld51XRhLwaBpPdfa",
  claimedAt: "fldZCA0LWYiaaqVsj",
} as const;

/** 💬 Concierge Messages — one row per message. */
const M = {
  message: "fldSuyKzZg7duKvta",
  thread: "fldWzLSeKoBndWBU1",
  guest: "fldGNupUVdh7cg4iP",
  direction: "flddgwPwQGwnFaA2h",
  channel: "fld1G1mYRxVtFJFcy",
  body: "fldtAj5EsRi08NHNu",
  sentAt: "fld0znwyrqWybOskz",
  sid: "fldwnbeJy6kfEit9S",
  status: "fldqydoEwUjrwdktF",
  draftReply: "fldJX6sDguYRZaEU4",
  draftModel: "fldZjDuXPx9IZBrd0",
  draftNote: "fldF9yYWB1N9gpj2v",
  draftUnresolved: "fld94Kzd3rmgUHChF",
  send: "fldE7b7niUkQXd34I",
  error: "fld8y0WqieGS6iqPz",
} as const;

const BY_FIELD_ID = { returnFieldsByFieldId: "true" } as const;

type Row = { id: string; createdTime: string; fields: Record<string, unknown> };

function str(f: Record<string, unknown>, id: string): string | null {
  const v = f[id];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
function bool(f: Record<string, unknown>, id: string): boolean {
  return f[id] === true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Direction = "Inbound" | "Outbound";

export type ConciergeThread = {
  id: string;
  title: string;
  guestId: string | null;
  guestName: string | null;
  phone: string | null;
  status: string | null;
  lastMessageAt: string | null;
  lastDirection: Direction | null;
  /**
   * mercury-server's `Unread`. It means "a guest has written and we have not
   * replied yet" — it is SET on every inbound and CLEARED only by a successful
   * send. So it is a reply queue, not a seen/unseen flag, and it cannot tell you
   * whether anyone is already working on it. That is what `claimedBy` is for.
   */
  awaitingReply: boolean;
  optedOut: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  messageIds: string[];
};

export type ThreadListItem = ConciergeThread & {
  /** First line of the most recent message, for the list. */
  preview: string | null;
  previewDirection: Direction | null;
};

export type ConciergeMessage = {
  id: string;
  direction: Direction | null;
  channel: string | null;
  body: string;
  sentAt: string | null;
  createdTime: string;
  status: string | null;
  draftReply: string | null;
  draftNote: string | null;
  draftUnresolved: string | null;
  draftModel: string | null;
  sendChecked: boolean;
  error: string | null;
};

export type GuestContext = {
  tripCode: string;
  tripName: string;
  startDate: string | null;
  endDate: string | null;
  timeframe: "in_progress" | "upcoming" | "past" | "undated";
  /** Today and the next day that has anything on it. Not the whole trip. */
  days: ItineraryDay[];
};

export type ThreadDetail = {
  thread: ConciergeThread;
  messages: ConciergeMessage[];
  /**
   * The row a reply hangs off: the most recent inbound message. mercury-server's
   * send route reads `Draft Reply` from a message row, so there is no way to
   * text a guest who has not written first — a real gap, and the reason this can
   * be null.
   */
  replyTo: ConciergeMessage | null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function toThread(row: Row, guests: Map<string, string>): ConciergeThread {
  const f = row.fields;
  const guestId = linkedIds(f[T.guest])[0] ?? null;
  const dir = str(f, T.lastDirection);
  const phone = str(f, T.phone);
  // A guest row can carry a Full Name that is only whitespace — one in the live
  // base is a single space — and `?? ` would happily hand that to the heading,
  // which then renders as nothing at all. Trim to null, and fall back to the
  // number: a phone is always something a concierge can act on, "untitled
  // thread" never is.
  const named = guestId ? (guests.get(guestId) ?? "").trim() : "";
  return {
    id: row.id,
    title: str(f, T.thread) ?? phone ?? "unknown number",
    guestId,
    guestName: named || null,
    phone,
    status: str(f, T.status),
    lastMessageAt: str(f, T.lastMessageAt),
    lastDirection: dir === "Inbound" || dir === "Outbound" ? dir : null,
    awaitingReply: bool(f, T.unread),
    optedOut: bool(f, T.optedOut),
    claimedBy: str(f, T.claimedBy),
    claimedAt: str(f, T.claimedAt),
    messageIds: linkedIds(f[T.messages]),
  };
}

function toMessage(row: Row): ConciergeMessage {
  const f = row.fields;
  const dir = str(f, M.direction);
  return {
    id: row.id,
    direction: dir === "Inbound" || dir === "Outbound" ? dir : null,
    channel: str(f, M.channel),
    body: str(f, M.body) ?? "",
    sentAt: str(f, M.sentAt),
    createdTime: row.createdTime,
    status: str(f, M.status),
    draftReply: str(f, M.draftReply),
    draftNote: str(f, M.draftNote),
    draftUnresolved: str(f, M.draftUnresolved),
    draftModel: str(f, M.draftModel),
    sendChecked: bool(f, M.send),
    error: str(f, M.error),
  };
}

/** Airtable record ids are `rec` + 14 url-safe chars. Anything else cannot
 *  address a record and must never reach a formula or a request path. */
export function isRecordId(id: string): boolean {
  return /^rec[A-Za-z0-9]{14}$/.test(id);
}

/** `OR(RECORD_ID()='rec…', …)` — references no field name, so no rename can
 *  break it. Returns null for an empty set (Airtable rejects a bare `OR()`). */
function recordIdFilter(ids: string[]): string | null {
  const safe = ids.filter(isRecordId);
  if (safe.length === 0) return null;
  return `OR(${safe.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
}

/** Airtable takes the formula in the query string, so the OR cannot grow without
 *  limit. A hundred ids is ~2.8k characters, comfortably inside the URL budget,
 *  and keeps a one-thread read at exactly one request. */
const ID_CHUNK = 100;

async function readMessagesByIds(ids: string[]): Promise<ConciergeMessage[]> {
  if (!TOKEN) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));

  const out: ConciergeMessage[] = [];
  for (const chunk of chunks) {
    const formula = recordIdFilter(chunk);
    if (!formula) continue;
    const rows = await fetchAllPages<Row>(MESSAGES_TABLE_ID, formula, BY_FIELD_ID);
    out.push(...rows.map(toMessage));
  }
  return out;
}

/** Every thread, freshly. Cached only briefly: this is a live queue, and an ops
 *  user staring at a stale list is the failure that matters here. */
export const loadThreads = makeCached(async (): Promise<ThreadListItem[]> => {
  if (!TOKEN) return [];
  const [rows, guests] = await Promise.all([
    fetchAllPages<Row>(THREADS_TABLE_ID, undefined, BY_FIELD_ID),
    loadGuestsMap(),
  ]);
  const threads = rows.map((r) => toThread(r, guests));

  // One extra read for the whole list: the last message of every thread, all in
  // a single RECORD_ID() query. The link array is read from the END, so this
  // stays one row per thread however long a thread runs.
  const lastIds = threads.map((t) => t.messageIds[t.messageIds.length - 1]).filter(Boolean);
  const previews = new Map<string, ConciergeMessage>();
  for (const m of await readMessagesByIds(lastIds)) previews.set(m.id, m);

  const list = threads.map((t): ThreadListItem => {
    const last = previews.get(t.messageIds[t.messageIds.length - 1] ?? "");
    // Null, not "", for an empty body — the list falls back on null and would
    // otherwise render a blank line where "no messages yet" belongs.
    const firstLine = last?.body?.split("\n")[0]?.slice(0, 160)?.trim();
    return {
      ...t,
      preview: firstLine ? firstLine : null,
      previewDirection: last?.direction ?? null,
    };
  });

  // Waiting guests first, longest wait at the top — that is the order a
  // concierge desk actually works in. Everything else falls back to most recent.
  return list.sort((a, b) => {
    if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1;
    const at = a.lastMessageAt ?? "";
    const bt = b.lastMessageAt ?? "";
    if (a.awaitingReply) return at.localeCompare(bt); // oldest wait first
    return bt.localeCompare(at); // most recent first
  });
}, 15_000, 120_000);

/**
 * The guest's live trip, if they have one: the trip in progress, else the next
 * one starting. This is the whole point of answering texts from inside ops
 * rather than a helpdesk — the guest asks what time the car comes and the answer
 * is on the same screen.
 *
 * CACHED HARD, AND ON PURPOSE. `loadItinerary` fans out across every booking
 * table for the trip, and the thread page re-renders every 20 seconds while a
 * concierge sits on it. Uncached, one open thread would be ~17 Airtable reads
 * every 20s against a base whose limit is 5 requests a second — enough to start
 * 429ing the guest app. The transcript is what has to be live; a trip does not
 * change minute to minute, so it gets a 5-minute window and is rendered as its
 * own streamed component so it can never hold the conversation up.
 */
async function loadGuestContextUncached(guestId: string | null): Promise<GuestContext | null> {
  if (!guestId) return null;
  const rows = await loadTripRows();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const mine = rows
    .filter((r) => {
      const ids = [...linkedIds(r.fields["Lead Guest"]), ...linkedIds(r.fields["Companions"])];
      return ids.includes(guestId);
    })
    .map((r) => ({
      code: r.fields["Trip ID"] ?? "",
      name: r.fields["Internal Trip Name"] ?? r.fields["External Trip Name"] ?? r.fields["Trip ID"] ?? "untitled trip",
      start: r.fields["Trip Start Date"] ?? null,
      end: r.fields["Trip End Date"] ?? null,
    }))
    .filter((t) => t.code);

  const withFrame = mine.map((t) => ({ ...t, frame: timeframeOf(t.start ?? null, t.end ?? null, now) }));
  const pick =
    withFrame.find((t) => t.frame === "in_progress") ??
    withFrame
      .filter((t) => t.frame === "upcoming")
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
  if (!pick) return null;

  let days: ItineraryDay[] = [];
  try {
    const itin = await loadItinerary(pick.code);
    // Today onwards, first two days that actually have something on them. A
    // thread panel is a glance, not the itinerary page — the full admin view is
    // one click away.
    days = (itin?.days ?? []).filter((d) => d.date >= today && d.reservations.length > 0).slice(0, 2);
  } catch {
    // A booking table that will not load must not take the thread down with it.
    days = [];
  }

  return {
    tripCode: pick.code,
    tripName: pick.name,
    startDate: pick.start ?? null,
    endDate: pick.end ?? null,
    timeframe: pick.frame,
    days,
  };
}

const CONTEXT_REVALIDATE_S = 300;

/** The guest's trip panel. Keyed per guest so two concierges on two threads do
 *  not share (or bust) each other's window. */
export const loadGuestContext = unstable_cache(
  loadGuestContextUncached,
  ["concierge-guest-context"],
  { revalidate: CONTEXT_REVALIDATE_S },
);

/** One thread, its transcript, and the row a reply hangs off.
 *
 *  Deliberately does NOT load the guest's trip: this runs on every 20-second
 *  poll, and the trip panel is loaded separately (and cached) so the two have
 *  independent costs. */
export async function loadThreadDetail(threadId: string): Promise<ThreadDetail | null> {
  if (!TOKEN || !isRecordId(threadId)) return null;
  const formula = recordIdFilter([threadId]);
  if (!formula) return null;

  const [rows, guests] = await Promise.all([
    fetchAllPages<Row>(THREADS_TABLE_ID, formula, BY_FIELD_ID),
    loadGuestsMap(),
  ]);
  if (rows.length === 0) return null;
  const thread = toThread(rows[0], guests);

  // Bounded from the end, like the consumer's own reader: a thread that runs for
  // a year still costs one request.
  const recent = thread.messageIds.slice(-60);
  const messages = await readMessagesByIds(recent);

  messages.sort((a, b) => (a.sentAt ?? a.createdTime).localeCompare(b.sentAt ?? b.createdTime));

  const replyTo = [...messages].reverse().find((m) => m.direction === "Inbound") ?? null;

  return { thread, messages, replyTo };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const authHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function patchRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!TOKEN) return { ok: false, error: "No Airtable token is set on this app." };
  if (!isRecordId(recordId)) return { ok: false, error: "That is not a record id." };
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers: authHeaders,
    // NO typecast, deliberately — the same rule mercury-server writes under.
    // These rows are driven by texts from outside Mercury, and typecast would
    // let a typo mint a new option in a shared picklist.
    body: JSON.stringify({ fields, returnFieldsByFieldId: true }),
  });
  if (!res.ok) return { ok: false, error: `Airtable said ${res.status}: ${await res.text()}` };
  return { ok: true };
}

// --- mercury-server ---------------------------------------------------------

const SERVER_URL = process.env.MERCURY_SERVER_URL || "https://mercury-server.fly.dev";
const APP_KEY = process.env.MERCURY_APP_KEY;
const OPS_SECRET = process.env.CONCIERGE_OPS_SECRET;

/** `/internal/*` sits behind BOTH guards: the transport key every API path
 *  carries, and the ops secret for these two routes specifically. One without
 *  the other is a 401. */
export function serverConfigured(): boolean {
  return Boolean(APP_KEY && OPS_SECRET);
}

type ServerVerdict = { ok: true; body: unknown } | { ok: false; status: number; error: string };

async function callServer(path: string, messageId: string): Promise<ServerVerdict> {
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mercury-key": APP_KEY ?? "",
        "x-internal-secret": OPS_SECRET ?? "",
      },
      body: JSON.stringify({ messageId }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = typeof body?.error === "string" ? body.error : `http_${res.status}`;
      return { ok: false, status: res.status, error: code };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network" };
  }
}

/**
 * mercury-server answers with a machine code. Ops get a sentence that says what
 * happened and what to do about it — the same standard the engine holds itself
 * to when it writes onto the row.
 */
function explain(code: string): string {
  switch (code) {
    case "opted_out":
      return "This guest texted STOP and is opted out of SMS. Call them instead — do not text again until they text START.";
    case "body_too_long":
      return "That reply is too long to send as a text. Shorten it, or call the guest.";
    case "empty_body":
      return "There is nothing to send. Write a reply first.";
    case "no_phone":
      return "This thread has no phone number on it, so there is nowhere to send.";
    case "no_thread":
      return "This message is not linked to a thread, so there is no number to reply to.";
    case "already_sent":
      return "This one has already gone out.";
    case "send_not_requested":
      return "Something else sent this first. Reload to see what went out.";
    case "already_sending":
      return "This is already going out. Give it a second and reload.";
    case "message_not_found":
    case "thread_not_found":
      return "That message is no longer in Airtable. Reload the thread.";
    case "concierge_not_configured":
    case "store_not_configured":
    case "twilio_not_configured":
      return "The SMS line is switched off on the server, so nothing can go out right now.";
    case "unauthorized":
      return "Ops is not authorised to send. Check MERCURY_APP_KEY and CONCIERGE_OPS_SECRET.";
    default:
      return `The send failed (${code}).`;
  }
}

export type ComposeResult =
  | { ok: true; sent: true }
  | { ok: false; error: string };

export type SendResult =
  | { ok: true; sent: true }
  /** Ticked in Airtable, but this app could not get a verdict — the deployed
   *  Airtable automation is the backstop and will still send it. */
  | { ok: true; sent: false; note: string }
  | { ok: false; error: string };

/** Save the concierge's edit without sending. */
export async function saveDraft(messageId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await patchRecord(MESSAGES_TABLE_ID, messageId, { [M.draftReply]: text });
  loadThreads.bust();
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Send the reply. Two steps, in this order:
 *
 *   1. Write the text and tick `Send` in Airtable. The text that goes out is
 *      whatever `Draft Reply` says at that moment, so this must land first.
 *   2. Ask mercury-server to send it now, and report its real verdict.
 *
 * Step 2 is what turns "ticked a box and hoped" into an answer on screen. It is
 * safe to race the deployed Airtable automation, which is watching the same
 * checkbox: mercury-server unticks `Send` before it calls Twilio, so the loser
 * of the race reads the box as false and refuses. If step 2 cannot run at all
 * (no secrets set here), the automation is still the backstop and we say so
 * rather than claiming a send we did not witness.
 */
export async function sendReply(messageId: string, text: string): Promise<SendResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "There is nothing to send. Write a reply first." };

  const patched = await patchRecord(MESSAGES_TABLE_ID, messageId, {
    [M.draftReply]: body,
    [M.send]: true,
  });
  if (!patched.ok) return { ok: false, error: patched.error };

  if (!serverConfigured()) {
    loadThreads.bust();
    return {
      ok: true,
      sent: false,
      note: "Handed to the Airtable automation. It usually goes out within a minute; reload to confirm.",
    };
  }

  const verdict = await callServer("/internal/concierge/send", messageId);
  loadThreads.bust();
  if (verdict.ok) return { ok: true, sent: true };

  // A network failure here does NOT mean the message is stuck: `Send` is ticked
  // and the automation is watching. Say so rather than reporting a failure that
  // is about to become a delivered text.
  if (verdict.status === 0) {
    return {
      ok: true,
      sent: false,
      note: "Could not reach the server, but the reply is ticked to send and the Airtable automation will pick it up. Reload to confirm.",
    };
  }

  // The refusals that come from the send logic itself (opted out, too long, no
  // phone…) have already unticked `Send` server-side and written the reason onto
  // the row. These two do NOT: they are refused by the guards in front of the
  // route, before it ever reads the record. Left alone, `Send` would stay ticked
  // and the Airtable automation would deliver a text we just told the concierge
  // had failed — and they would write it again. So untick it ourselves.
  if (verdict.error === "unauthorized" || verdict.error === "bad_message_id") {
    await patchRecord(MESSAGES_TABLE_ID, messageId, { [M.send]: false });
  }
  return { ok: false, error: explain(verdict.error) };
}

/**
 * Send a message to the thread. Not a reply to any particular text.
 *
 * The old path wrote the body onto an inbound row and ticked `Send`, which made
 * a reply structurally one-per-guest-text: no follow-up, no correction, and no
 * reaching a guest who had not written first. Ops need to say a second thing
 * without the guest having to speak first, so an outbound message belongs to the
 * thread.
 */
export async function composeMessage(threadId: string, text: string): Promise<ComposeResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "There is nothing to send. Write a message first." };
  if (!serverConfigured()) {
    return {
      ok: false,
      error: "Sending needs MERCURY_APP_KEY and CONCIERGE_OPS_SECRET set on this app.",
    };
  }
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/internal/concierge/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mercury-key": APP_KEY ?? "",
        "x-internal-secret": OPS_SECRET ?? "",
      },
      body: JSON.stringify({ threadId, body }),
      cache: "no-store",
    });
  } catch {
    // Unlike the checkbox path there is no Airtable automation standing behind
    // this one, so an unreachable server means nothing was sent. Say exactly
    // that rather than implying it might still arrive.
    return { ok: false, error: "Could not reach the server, so nothing was sent. Try again." };
  }
  loadThreads.bust();
  if (res.ok) return { ok: true, sent: true };
  const payload = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  const code = typeof payload?.error === "string" ? payload.error : `http_${res.status}`;
  return { ok: false, error: code === "send_failed" && payload.detail ? payload.detail : explain(code) };
}

/** Ask Claude for the draft again — the recovery path for a row stuck at
 *  Drafting, or a draft that came back wrong. Never sends. */
export async function redraft(messageId: string): Promise<{ ok: boolean; error?: string }> {
  if (!serverConfigured()) {
    return { ok: false, error: "Redraft needs MERCURY_APP_KEY and CONCIERGE_OPS_SECRET set on this app." };
  }
  const verdict = await callServer("/internal/concierge/draft", messageId);
  loadThreads.bust();
  return verdict.ok ? { ok: true } : { ok: false, error: explain(verdict.error) };
}

/**
 * Claim a thread, so a second concierge can see someone is already on it.
 *
 * A hint, not a lock: it is stored only here and mercury-server neither reads
 * nor writes it, so a forgotten claim can never stop a reply going out. Passing
 * a null `who` releases it.
 */
export async function claimThread(threadId: string, who: string | null): Promise<{ ok: boolean; error?: string }> {
  const res = await patchRecord(THREADS_TABLE_ID, threadId, {
    [T.claimedBy]: who ?? "",
    [T.claimedAt]: who ? new Date().toISOString() : null,
  });
  loadThreads.bust();
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
