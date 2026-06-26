"use client";

import { useEffect, useRef, useState } from "react";
import { BOOKING_CONFIG, BOOKING_TYPES, type BookingType } from "@/lib/bookingFields";
import { BookingEditor } from "./BookingEditor";
import { LinkBookingEditor } from "./LinkBookingEditor";

// A contextual "+ add" next to a day's date. Opens a small type menu; picking a
// type opens the booking drawer with that day's date pre-filled.
export function DayAdd({
  date,
  tripCode,
  tripName,
  tripRecordId,
}: {
  date: string;
  tripCode: string;
  tripName: string;
  tripRecordId: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<BookingType | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="day-add" ref={ref}>
      <button
        type="button"
        className="day-add-btn label"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-label="Add a booking to this day"
      >
        + add
      </button>

      {menuOpen ? (
        <div className="day-add-menu" role="menu">
          {BOOKING_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              className="bk-menu-item"
              onClick={() => {
                setMenuOpen(false);
                setSelected(t);
              }}
            >
              {BOOKING_CONFIG[t].label}
            </button>
          ))}
          <hr className="day-add-sep" />
          <button
            type="button"
            role="menuitem"
            className="bk-menu-item bk-menu-link"
            onClick={() => {
              setMenuOpen(false);
              setLinkOpen(true);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9.5 13.5a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 1 0-5.66-5.66l-1.4 1.4" />
              <path d="M14.5 10.5a4 4 0 0 0-5.66 0L6 13.34a4 4 0 1 0 5.66 5.66l1.4-1.4" />
            </svg>
            <span>Link existing booking</span>
          </button>
        </div>
      ) : null}

      {selected ? (
        <BookingEditor
          type={selected}
          variant="add"
          triggerVariant="none"
          defaultOpen
          initialDate={date}
          tripCode={tripCode}
          tripName={tripName}
          tripRecordId={tripRecordId}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {linkOpen ? (
        <LinkBookingEditor
          defaultOpen
          initialDate={date}
          tripCode={tripCode}
          tripName={tripName}
          tripRecordId={tripRecordId}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
    </div>
  );
}
