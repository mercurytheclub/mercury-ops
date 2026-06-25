"use client";

import { useMemo, useState } from "react";
import type { OpsTrip } from "@/server/airtable";

const GROUPS: { key: OpsTrip["timeframe"]; label: string }[] = [
  { key: "in_progress", label: "in progress" },
  { key: "upcoming", label: "upcoming" },
  { key: "past", label: "past" },
  { key: "undated", label: "undated" },
];

function fmtRange(start: string | null, end: string | null): string {
  if (!start) return "dates tbc";
  return end && end !== start ? `${start} — ${end}` : start;
}

// Match against the fields an ops user would search by. Cheap client-side
// filter — the full trip list is already loaded, so no round-trip.
function matches(t: OpsTrip, q: string): boolean {
  const haystack = [
    t.name,
    t.leadGuest,
    t.leadDestination,
    t.tripCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function TripsList({ trips }: { trips: OpsTrip[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () => (q ? trips.filter((t) => matches(t, q)) : trips),
    [trips, q],
  );

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search trips — guest, destination, trip code…"
          aria-label="search trips"
          autoComplete="off"
          spellCheck={false}
          style={{
            width: "100%",
            background: "transparent",
            border: 0,
            borderBottom: "1px solid var(--mercury-rule)",
            color: "var(--mercury-white)",
            font: "inherit",
            fontSize: "1rem",
            padding: "0.6rem 0",
            outline: "none",
          }}
        />
        {q && (
          <span className="label" style={{ opacity: 0.5 }}>
            {filtered.length} {filtered.length === 1 ? "match" : "matches"}
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <p style={{ opacity: 0.6 }}>no trips match “{query.trim()}”.</p>
      ) : (
        GROUPS.map(({ key, label }) => {
          const group = filtered.filter((t) => t.timeframe === key);
          if (group.length === 0) return null;
          return (
            <section key={key} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <h2 className="label" style={{ margin: 0 }}>
                {label} <span style={{ opacity: 0.5 }}>· {group.length}</span>
              </h2>
              <hr className="hairline" />
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
                {group.map((t) => (
                  <li key={t.tripCode}>
                    <a
                      href={`/trip/${encodeURIComponent(t.tripCode)}`}
                      style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem 1.5rem", padding: "0.9rem 0", color: "var(--mercury-white)" }}
                    >
                      <span style={{ fontSize: "1.05rem" }}>{t.name}</span>
                      <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.8rem", opacity: 0.6, textAlign: "right" }}>
                        {fmtRange(t.startDate, t.endDate)}
                      </span>
                      <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>
                        {t.leadGuest}
                        {t.guestCount > 1 ? ` · ${t.guestCount} guests` : ""}
                        {t.leadDestination ? ` · ${t.leadDestination}` : ""}
                      </span>
                      <span className="label" style={{ textAlign: "right", opacity: 0.55 }}>{t.tripCode}</span>
                    </a>
                    <hr className="hairline" style={{ opacity: 0.4 }} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}
