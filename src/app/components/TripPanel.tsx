import { loadGuestContext } from "@/server/concierge";
import { clockOf } from "@/lib/waited";

// The guest's live trip, beside their thread. This is the reason the inbox is
// here rather than in a bought helpdesk: the guest asks what time the car comes
// and the answer is already on screen.
//
// A server component of its own, streamed inside a Suspense boundary, because
// reading a trip means reading every booking table for it. The conversation is
// what has to be instant; this arrives a moment later.

export async function TripPanel({ guestId }: { guestId: string | null }) {
  if (!guestId) {
    return <p className="cx-context-empty">This thread is not linked to a guest record.</p>;
  }

  const context = await loadGuestContext(guestId);
  if (!context) {
    return <p className="cx-context-empty">No trip in progress or coming up for this guest.</p>;
  }

  return (
    <div className="cx-context">
      <span className="label cx-context-head">
        {context.timeframe === "in_progress" ? "travelling now" : "next trip"}
      </span>
      <a href={`/trip/${context.tripCode}`} className="cx-context-trip">
        {context.tripName}
      </a>
      <span className="cx-context-dates">
        {context.startDate ?? "dates tbc"}
        {context.endDate && context.endDate !== context.startDate ? ` — ${context.endDate}` : ""}
      </span>

      {context.days.length > 0 ? (
        context.days.map((day) => (
          <div key={day.date} className="cx-day">
            <span className="cx-day-date">{day.date}</span>
            {day.reservations.map((r) => (
              <div key={r.id} className="cx-res">
                <span className="cx-res-time">{clockOf(r.startAt) || "—"}</span>
                <span className="cx-res-body">
                  <span className="label cx-res-cat">{r.category.replace(/_/g, " ")}</span>
                  <span className="cx-res-title">{r.title}</span>
                  {r.location && <span className="cx-res-meta">{r.location}</span>}
                </span>
              </div>
            ))}
          </div>
        ))
      ) : (
        // Deliberately not "nothing is booked": a booking table that rate-limited
        // is dropped silently upstream, so this panel cannot promise the trip is
        // empty. It points at the page that can.
        <span className="cx-context-empty">Nothing showing from today. Open the trip to be sure.</span>
      )}

      <a href={`/trip/${context.tripCode}`} className="cx-context-link label">
        open the full trip
      </a>
    </div>
  );
}
