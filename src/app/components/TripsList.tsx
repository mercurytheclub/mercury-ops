"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OpsTrip } from "@/server/airtable";
import { TripEditor } from "./TripEditor";

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
  const haystack = [t.name, t.leadGuest, t.leadDestination, t.tripCode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

function SearchGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function TripsList({ trips }: { trips: OpsTrip[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();

  // Trips created this session, shown instantly. Once the server list catches up
  // (it includes the new code), the optimistic copy is deduped out.
  const [created, setCreated] = useState<OpsTrip[]>([]);
  const allTrips = useMemo(() => {
    const codes = new Set(trips.map((t) => t.tripCode));
    return [...created.filter((c) => !codes.has(c.tripCode)), ...trips];
  }, [trips, created]);

  function handleCreated(trip: OpsTrip) {
    setCreated((c) => [trip, ...c]);
    router.refresh(); // reconcile with canonical Airtable data in the background
  }

  const filtered = useMemo(
    () => (q ? allTrips.filter((t) => matches(t, q)) : allTrips),
    [allTrips, q],
  );

  function openSearch() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closeSearch() {
    setOpen(false);
    setQuery("");
  }

  // Collapse on Escape; keep the affordance out of the way otherwise.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSearch();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", minHeight: "1.9rem" }}>
        <TripEditor onCreated={handleCreated} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.55rem",
            borderBottom: `1px solid ${open ? "var(--mercury-rule)" : "transparent"}`,
            transition: "border-color 200ms ease",
            paddingBottom: "0.3rem",
          }}
        >
          {open && q && (
            <span className="label" style={{ opacity: 0.4, whiteSpace: "nowrap" }}>
              {filtered.length}
            </span>
          )}
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => { if (!query) setOpen(false); }}
            placeholder="guest, destination, trip code…"
            aria-label="search trips"
            aria-hidden={!open}
            tabIndex={open ? 0 : -1}
            autoComplete="off"
            spellCheck={false}
            style={{
              width: open ? "min(20rem, 60vw)" : 0,
              opacity: open ? 1 : 0,
              background: "transparent",
              border: 0,
              color: "var(--mercury-white)",
              font: "inherit",
              fontSize: "0.9rem",
              padding: 0,
              outline: "none",
              transition: "width 240ms ease, opacity 160ms ease",
            }}
          />
          <button
            type="button"
            onClick={open ? closeSearch : openSearch}
            aria-label={open ? "close search" : "search trips"}
            aria-expanded={open}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              color: "var(--mercury-white)",
              opacity: 0.65,
              flexShrink: 0,
            }}
          >
            {open ? <CloseGlyph /> : <SearchGlyph />}
          </button>
        </div>
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
