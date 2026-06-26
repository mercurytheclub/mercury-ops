"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createTripAction, loadGuestOptionsAction } from "@/app/actions";
import { showToast } from "@/app/components/Toast";
import type { GuestOption, OpsTrip } from "@/server/airtable";
import type { GuestRef } from "@/server/trips";

const ACCENT = "#52A5D3";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Mirror Airtable's External Trip Name formula so the user sees exactly what the
// trip will be called before they create it: "{Destination} - {MMM YYYY}".
function previewName(destination: string, start: string): string | null {
  const d = destination.trim();
  if (!d) return null;
  if (!start) return d;
  const [y, m] = start.split("-");
  const mon = MONTHS[parseInt(m, 10) - 1];
  return mon ? `${d} - ${mon} ${y}` : d;
}

export function TripEditor({ onCreated }: { onCreated: (trip: OpsTrip) => void }) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leadGuest, setLeadGuest] = useState<GuestRef | null>(null);
  const [companions, setCompanions] = useState<GuestRef[]>([]);
  const [guests, setGuests] = useState<GuestOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();
  const destRef = useRef<HTMLInputElement>(null);

  function reset() {
    setDestination("");
    setStartDate("");
    setEndDate("");
    setLeadGuest(null);
    setCompanions([]);
    setError(null);
  }

  function close() {
    setOpen(false);
  }

  async function handleOpen() {
    reset();
    setOpen(true);
    requestAnimationFrame(() => destRef.current?.focus());
    if (!guests) {
      const opts = await loadGuestOptionsAction();
      setGuests(opts);
    }
  }

  // Lock body scroll + close on Escape while the drawer is open.
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
  }, [open, pending]);

  function handleCreate() {
    if (!destination.trim()) {
      setError("a destination is required");
      destRef.current?.focus();
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await createTripAction({
        leadDestination: destination,
        startDate: startDate || null,
        endDate: endDate || null,
        leadGuest,
        companions,
      });
      if (res.ok) {
        showToast(`Trip created${res.trip.tripCode ? ` · ${res.trip.tripCode}` : ""}`);
        onCreated(res.trip);
        close();
      } else {
        setError(res.error);
      }
    });
  }

  const preview = previewName(destination, startDate);

  return (
    <>
      <button type="button" onClick={handleOpen} className="trip-new-btn label" aria-label="Create a new trip">
        <span className="trip-new-plus" aria-hidden>+</span>
        new trip
      </button>

      {open ? (
        <div className="bk-overlay" role="dialog" aria-modal="true" aria-label="new trip">
          <div className="bk-backdrop" onClick={() => !pending && close()} />
          <div className="bk-panel">
            <header className="bk-panel-head">
              <div>
                <span className="label" style={{ color: ACCENT, fontSize: "0.62rem" }}>new</span>
                <h2 style={{ margin: "0.2rem 0 0", fontSize: "1.3rem", fontWeight: 400 }}>trip</h2>
              </div>
              <button type="button" className="bk-close" onClick={() => !pending && close()} aria-label="Close">
                ✕
              </button>
            </header>

            <div className="bk-form">
              <label className="bk-field">
                <span className="bk-label label">Destination</span>
                <input
                  ref={destRef}
                  className="bk-input"
                  placeholder="e.g. Hawaii, Italy, Maldives"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
                <span className="trip-preview">
                  {preview ? (
                    <>appears as <strong>{preview}</strong></>
                  ) : (
                    "names the trip — destination + start month"
                  )}
                </span>
              </label>

              <label className="bk-field bk-half">
                <span className="bk-label label">Start date</span>
                <input className="bk-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="bk-field bk-half">
                <span className="bk-label label">End date</span>
                <input className="bk-input" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
              </label>

              <div className="bk-field">
                <span className="bk-label label">Lead guest</span>
                <GuestPicker
                  mode="single"
                  options={guests}
                  selected={leadGuest ? [leadGuest] : []}
                  onAdd={(ref) => setLeadGuest(ref)}
                  onRemove={() => setLeadGuest(null)}
                  placeholder="search guests, or type a new name…"
                />
              </div>

              <div className="bk-field">
                <span className="bk-label label">Companions</span>
                <GuestPicker
                  mode="multi"
                  options={guests}
                  selected={companions}
                  onAdd={(ref) => setCompanions((c) => [...c, ref])}
                  onRemove={(i) => setCompanions((c) => c.filter((_, idx) => idx !== i))}
                  placeholder="add travelling companions…"
                />
              </div>
            </div>

            <footer className="bk-panel-foot">
              {error ? <p className="bk-error">{error}</p> : null}
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" className="bk-btn-ghost label" onClick={() => close()} disabled={pending}>
                  cancel
                </button>
                <button type="button" className="bk-btn-save label" onClick={handleCreate} disabled={pending || !destination.trim()}>
                  {pending ? "creating…" : "create trip"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── Guest picker ─────────────────────────────────────────────────────────────
// A combobox over existing guests with inline "create new". Single mode holds at
// most one (lead guest); multi accumulates (companions). Selected guests show as
// removable chips; typing filters the list (and offers to create the typed name).
function GuestPicker({
  mode,
  options,
  selected,
  onAdd,
  onRemove,
  placeholder,
}: {
  mode: "single" | "multi";
  options: GuestOption[] | null;
  selected: GuestRef[];
  onAdd: (ref: GuestRef) => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const selectedIds = new Set(selected.map((s) => s.id).filter(Boolean) as string[]);
  const selectedNames = new Set(selected.map((s) => s.name.toLowerCase()));

  const matches = q && options
    ? options.filter((o) => o.name.toLowerCase().includes(q) && !selectedIds.has(o.id)).slice(0, 8)
    : [];
  const exists = !!options?.some((o) => o.name.toLowerCase() === q) || selectedNames.has(q);
  const canCreate = q.length > 1 && !exists;
  // Single mode hides the input once a guest is chosen (clear the chip to swap).
  const showInput = mode === "multi" || selected.length === 0;

  function pick(ref: GuestRef) {
    if (ref.id && selectedIds.has(ref.id)) return;
    onAdd(ref);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length) pick({ id: matches[0].id, name: matches[0].name });
      else if (canCreate) pick({ name: query.trim(), isNew: true });
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  }

  return (
    <div className="gp">
      {selected.length > 0 ? (
        <div className="gp-chips">
          {selected.map((g, i) => (
            <span key={(g.id ?? g.name) + i} className={`gp-chip${g.isNew ? " gp-chip-new" : ""}`}>
              {g.name}
              {g.isNew ? <em className="gp-chip-tag">new</em> : null}
              <button type="button" className="gp-chip-x" onClick={() => onRemove(i)} aria-label={`Remove ${g.name}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {showInput ? (
        <div className="gp-box">
          <input
            className="bk-input gp-input"
            placeholder={options ? placeholder : "loading guests…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {q && (matches.length > 0 || canCreate) ? (
            <div className="gp-menu">
              {matches.map((o) => (
                <button key={o.id} type="button" className="gp-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick({ id: o.id, name: o.name })}>
                  {o.name}
                </button>
              ))}
              {canCreate ? (
                <button type="button" className="gp-item gp-create" onMouseDown={(e) => e.preventDefault()} onClick={() => pick({ name: query.trim(), isNew: true })}>
                  + create <strong>{query.trim()}</strong>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
