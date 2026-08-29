"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ThreadListItem } from "@/server/concierge";
import { waitedFor } from "@/lib/waited";

// The reply queue. Guests waiting on us at the top, longest wait first; settled
// threads below. The wait time is the number a concierge desk actually runs on,
// so it is the loudest thing on the row after the guest's name.

const REFRESH_MS = 20_000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function matches(t: ThreadListItem, q: string): boolean {
  const haystack = [t.title, t.guestName, t.phone, t.preview].filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function ThreadList({ threads }: { threads: ThreadListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Re-rendered on a tick so "waiting 12 minutes" keeps counting without a
  // round-trip. Set on the client only — a server-rendered relative time would
  // be wrong the moment it was cached.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? threads.filter((t) => matches(t, q)) : threads), [threads, q]);

  const waiting = filtered.filter((t) => t.awaitingReply);
  const settled = filtered.filter((t) => !t.awaitingReply);

  return (
    <div className="cx-list-wrap">
      <div className="cx-list-head">
        <span className="label" style={{ opacity: 0.55 }}>
          {waiting.length > 0 ? `${waiting.length} waiting on a reply` : "nobody waiting"}
        </span>
        <input
          className="cx-search"
          placeholder="search threads"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search threads"
        />
      </div>

      {waiting.length > 0 && (
        <section className="cx-group">
          <h2 className="label cx-group-head">waiting on us</h2>
          {waiting.map((t) => (
            <ThreadRow key={t.id} thread={t} now={now} urgent />
          ))}
        </section>
      )}

      {settled.length > 0 && (
        <section className="cx-group">
          <h2 className="label cx-group-head" style={{ opacity: 0.4 }}>
            answered
          </h2>
          {settled.map((t) => (
            <ThreadRow key={t.id} thread={t} now={now} />
          ))}
        </section>
      )}

      {filtered.length === 0 && <p style={{ opacity: 0.5 }}>No thread matches that.</p>}
    </div>
  );
}

function ThreadRow({
  thread,
  now,
  urgent = false,
}: {
  thread: ThreadListItem;
  now: number | null;
  urgent?: boolean;
}) {
  const name = thread.guestName ?? thread.title;
  const waited = now && thread.lastMessageAt ? waitedFor(thread.lastMessageAt, now) : null;

  return (
    <a href={`/inbox/${thread.id}`} className={`cx-row${urgent ? " cx-row-urgent" : ""}`}>
      <span className="cx-avatar" aria-hidden>
        {initials(name)}
      </span>

      <span className="cx-row-body">
        <span className="cx-row-top">
          <span className="cx-name">{name}</span>
          {thread.optedOut && <span className="cx-tag cx-tag-stop">opted out</span>}
          {thread.claimedBy && <span className="cx-tag cx-tag-claim">{thread.claimedBy}</span>}
        </span>
        <span className="cx-preview">
          {thread.previewDirection === "Outbound" && <span className="cx-preview-us">we said</span>}
          {thread.preview ?? "no messages yet"}
        </span>
      </span>

      <span className="cx-row-right">
        {waited && (
          <span className={`cx-waited${urgent && waited.minutes >= 15 ? " cx-waited-late" : ""}`}>
            {urgent ? `waiting ${waited.text}` : waited.text}
          </span>
        )}
        {thread.status && <span className="cx-status">{thread.status}</span>}
      </span>
    </a>
  );
}
