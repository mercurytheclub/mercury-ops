"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LINK_CONFIG, LINKABLE_TYPES, linkSearchHint, type LinkableType } from "@/lib/bookingFields";
import { searchLinkableBookingsAction, linkBookingAction } from "@/app/actions";
import { showToast } from "@/app/components/Toast";
import type { LinkableBooking } from "@/server/bookings";

const ACCENT = "#52A5D3";

function fmtDate(d: string | null): string {
  if (!d) return "no date";
  const date = new Date(d + "T00:00:00Z");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type Props = {
  tripCode: string;
  tripName: string;
  tripRecordId: string;
  /** Day to place a linked booking on (per-day entry). Confirms with this date. */
  initialDate?: string;
  defaultOpen?: boolean;
  onClose?: () => void;
};

// Opened by a parent (the per-day "link existing…" menu item) — mounted with
// defaultOpen, controlled via onClose. It renders no trigger of its own.
export function LinkBookingEditor({
  tripCode,
  tripName,
  tripRecordId,
  initialDate,
  defaultOpen = false,
  onClose,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LinkableType | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkableBooking[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LinkableBooking | null>(null);
  const [placeOn, setPlaceOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startLink] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  function reset() {
    setType(null);
    setQuery("");
    setResults([]);
    setSelected(null);
    setPlaceOn("");
    setError(null);
  }

  function close() {
    setOpen(false);
    onClose?.();
  }

  function handleOpen() {
    reset();
    setOpen(true);
  }

  useEffect(() => {
    if (defaultOpen) handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Body scroll lock + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  // Debounced search whenever the type or query changes (and nothing selected).
  useEffect(() => {
    if (!open || !type || selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await searchLinkableBookingsAction(type, tripCode, q);
      if (!cancelled) {
        setResults(res);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, type, query, selected, tripCode]);

  function chooseType(t: LinkableType) {
    setType(t);
    setSelected(null);
    setResults([]);
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function selectBooking(b: LinkableBooking) {
    setSelected(b);
    setPlaceOn(initialDate || b.date || "");
    setError(null);
  }

  function handleLink() {
    if (!selected) return;
    setError(null);
    startLink(async () => {
      const res = await linkBookingAction({
        type: selected.type,
        recordId: selected.recordId,
        tripRecordId,
        tripCode,
        date: placeOn || null,
        fromTripCodes: selected.otherTripCodes,
      });
      if (res.ok) {
        showToast(`${selected.title} linked to ${tripName}`);
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      {open ? (
        <div className="bk-overlay" role="dialog" aria-modal="true" aria-label="Link an existing booking">
          <div className="bk-backdrop" onClick={() => !pending && close()} />
          <div className="bk-panel">
            <header className="bk-panel-head">
              <div>
                <span className="label" style={{ color: ACCENT, fontSize: "0.62rem" }}>add to itinerary</span>
                <h2 style={{ margin: "0.2rem 0 0", fontSize: "1.3rem", fontWeight: 400 }}>
                  {selected ? selected.title : "Link an existing booking"}
                </h2>
              </div>
              <button type="button" className="bk-close" onClick={() => !pending && close()} aria-label="Close">✕</button>
            </header>

            <div className="bk-form">
              {!selected ? (
                <>
                  <div className="bk-field">
                    <span className="bk-label label">Type</span>
                    <div className="bk-chips">
                      {LINKABLE_TYPES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`bk-chip${type === t ? " bk-chip-on" : ""}`}
                          onClick={() => chooseType(t)}
                        >
                          {LINK_CONFIG[t].label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {type ? (
                    <div className="bk-field">
                      <span className="bk-label label">Search {LINK_CONFIG[type].label}s</span>
                      <input
                        ref={searchRef}
                        className="bk-input"
                        placeholder={linkSearchHint(type)}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <div aria-live="polite">
                        {query.trim().length >= 2 ? (
                          searching ? (
                            <p className="lb-hint">searching…</p>
                          ) : results.length === 0 ? (
                            <p className="lb-hint">no existing {LINK_CONFIG[type].label}s match — they may already be on this trip.</p>
                          ) : (
                            <div className="gp-menu lb-results" role="listbox" aria-label={`existing ${LINK_CONFIG[type].label}s`}>
                              {results.map((b) => (
                                <button key={b.recordId} type="button" role="option" aria-selected={false} className="gp-item lb-item" onClick={() => selectBooking(b)}>
                                  <span className="lb-title">{b.title}</span>
                                  <span className="lb-meta">
                                    {fmtDate(b.date)}{b.time ? ` · ${b.time}` : ""}
                                    {b.otherTripCodes.length ? <em className="lb-badge">on {b.otherTripCodes.join(", ")}</em> : null}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )
                        ) : (
                          <p className="lb-hint">type at least 2 characters to search.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="lb-hint">choose a booking type to search.</p>
                  )}
                </>
              ) : (
                <>
                  <div className="lb-selected">
                    <span className="label" style={{ color: ACCENT, fontSize: "0.6rem" }}>{LINK_CONFIG[selected.type].label}</span>
                    <span style={{ fontSize: "1.05rem" }}>{selected.title}</span>
                    <span className="lb-meta">
                      {fmtDate(selected.date)}{selected.time ? ` · ${selected.time}` : ""}
                      {selected.otherTripCodes.length ? <em className="lb-badge">currently on {selected.otherTripCodes.join(", ")}</em> : null}
                    </span>
                  </div>
                  {selected.otherTripCodes.length ? (
                    <p className="lb-hint" style={{ marginTop: 0 }}>
                      this booking is on {selected.otherTripCodes.join(", ")} — linking moves it to {tripName}.
                    </p>
                  ) : null}

                  <label className="bk-field">
                    <span className="bk-label label">Appears on</span>
                    <input className="bk-input" type="date" value={placeOn} onChange={(e) => setPlaceOn(e.target.value)} />
                    <span className="lb-hint">
                      {placeOn && placeOn !== selected.date
                        ? "moves the booking to this day (keeps its time)"
                        : "leave as-is to keep the booking on its own date"}
                    </span>
                  </label>

                  <button type="button" className="bk-btn-ghost label" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setSelected(null)}>
                    ← back to results
                  </button>
                </>
              )}
            </div>

            <footer className="bk-panel-foot">
              {error ? <p className="bk-error">{error}</p> : null}
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" className="bk-btn-ghost label" onClick={() => close()} disabled={pending}>cancel</button>
                <button type="button" className="bk-btn-save label" onClick={handleLink} disabled={pending || !selected}>
                  {pending ? "linking…" : "link booking"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
