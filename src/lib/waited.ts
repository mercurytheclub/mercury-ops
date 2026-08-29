// How long a guest has been waiting, in words.
//
// Shared by the inbox list and the thread page so the two can never disagree
// about what "waiting 40 minutes" means. Deliberately coarse: a concierge needs
// to know whether this is minutes or hours, not the second.
//
// `now` is always passed in rather than read here, because this runs on the
// client after hydration. A relative time computed during a server render would
// be baked into the cached HTML and start lying immediately.

export type Waited = { minutes: number; text: string };

export function waitedFor(iso: string, now: number): Waited {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return { minutes: 0, text: "" };
  const minutes = Math.max(0, Math.round((now - then) / 60_000));

  if (minutes < 1) return { minutes, text: "just now" };
  if (minutes < 60) return { minutes, text: `${minutes} min` };

  const hours = Math.round(minutes / 60);
  if (hours < 24) return { minutes, text: hours === 1 ? "1 hour" : `${hours} hours` };

  const days = Math.round(hours / 24);
  return { minutes, text: days === 1 ? "1 day" : `${days} days` };
}

/** Absolute wall clock for a message bubble, in the reader's own zone. */
export function clockOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Day heading for a run of messages ("Today", "Yesterday", else the date). */
export function dayOf(iso: string | null, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toDateString();
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString();
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
