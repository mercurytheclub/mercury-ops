import { loadItinerary } from "@/server/itinerary";
import type { Reservation } from "@/server/itinerary";
import { color } from "@brand";
import { Wordmark } from "@/app/components/Wordmark";
import { BookingEditor } from "@/app/components/BookingEditor";
import { DayAdd } from "@/app/components/DayAdd";
import { LinkBookingEditor } from "@/app/components/LinkBookingEditor";
import { type BookingType } from "@/lib/bookingFields";
import { notFound } from "next/navigation";

// Reservation categories that map 1:1 to an editable booking type.
const EDITABLE = new Set<Reservation["category"]>(["restaurant", "activity", "car", "greeter"]);
const isEditable = (c: Reservation["category"]): c is BookingType => EDITABLE.has(c);

// On-demand ISR: a trip renders the first time it's opened, then is served from
// cache and revalidated in the background every 60s. Each render only fetches
// THIS trip's bookings (filtered server-side), so even a cold render is fast.
export const revalidate = 60;

const CATEGORY_LABEL: Record<Reservation["category"], string> = {
  flight: "FLIGHT",
  hotel: "HOTEL",
  villa: "VILLA",
  car: "CAR SERVICE",
  restaurant: "RESTAURANT",
  activity: "ACTIVITY",
  greeter: "AIRPORT GREETER",
};

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function fmtDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

function ReservationCard({ r, tripCode, tripName }: { r: Reservation; tripCode: string; tripName: string }) {
  const time = timeOf(r.startAt);
  const a = r.admin;
  const hasAdmin = a.cost.length || a.supplier || a.contact || a.locator || a.notes;
  const recordId = r.id.slice(r.category.length + 1); // "restaurant-recXXX" → "recXXX"
  return (
    <div style={{ display: "grid", gridTemplateColumns: "5.5rem 1fr", gap: "0 1.25rem", padding: "1.1rem 0" }}>
      <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.8rem", opacity: 0.6, paddingTop: "0.15rem" }}>
        {time || "—"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <span className="label" style={{ color: color.blue, opacity: 0.9 }}>{CATEGORY_LABEL[r.category]}</span>
          {isEditable(r.category) ? (
            <BookingEditor variant="edit" type={r.category} recordId={recordId} tripCode={tripCode} tripName={tripName} />
          ) : null}
        </div>
        <span style={{ fontSize: "1.1rem" }}>{r.title}</span>
        {r.subtitle ? <span style={{ opacity: 0.7, fontSize: "0.9rem" }}>{r.subtitle}</span> : null}
        {r.location ? <span style={{ opacity: 0.55, fontSize: "0.85rem" }}>{r.location}</span> : null}
        {r.guests.length ? (
          <span style={{ opacity: 0.7, fontSize: "0.85rem" }}>{r.guests.join(", ")}</span>
        ) : null}

        {hasAdmin ? (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.7rem 0.9rem",
              borderLeft: `2px solid ${color.blue}`,
              background: "rgba(82,165,211,0.05)",
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
            }}
          >
            <span className="label" style={{ opacity: 0.5, fontSize: "0.62rem" }}>internal</span>
            {a.cost.map((c, i) => (
              <span key={i} style={{ fontSize: "0.85rem", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                <span style={{ opacity: 0.7 }}>{c.label}</span>
                <span style={{ fontFamily: "var(--font-mono), monospace" }}>{fmtMoney(c.amount, c.currency)}</span>
              </span>
            ))}
            {a.supplier ? <AdminRow k="supplier" v={a.supplier} /> : null}
            {a.contact ? <AdminRow k="contact" v={a.contact} /> : null}
            {a.locator ? <AdminRow k="locator" v={a.locator} /> : null}
            {a.notes ? <AdminRow k="notes" v={a.notes} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AdminRow({ k, v }: { k: string; v: string }) {
  return (
    <span style={{ fontSize: "0.85rem", display: "flex", gap: "0.6rem" }}>
      <span className="label" style={{ opacity: 0.45, fontSize: "0.62rem", minWidth: "4.5rem" }}>{k}</span>
      <span style={{ opacity: 0.85 }}>{v}</span>
    </span>
  );
}

export default async function TripPage({ params }: { params: Promise<{ tripCode: string }> }) {
  const { tripCode } = await params;
  const it = await loadItinerary(decodeURIComponent(tripCode));
  if (!it) notFound();

  const dateRange =
    it.startDate && it.endDate ? `${it.startDate} — ${it.endDate}` : it.startDate || "dates tbc";

  return (
    <main style={{ minHeight: "100vh", padding: "6vh 6vw", display: "flex", flexDirection: "column", gap: "2rem", maxWidth: 920, margin: "0 auto" }}>
      {/* Masthead mirrors the landing page: centered logo, then a control row
          beneath it. On the landing page that row holds the search (right-
          aligned); here it holds the back link (left-aligned, same row position). */}
      {/* Centered logo with generous space below it (its own header zone). */}
      <header style={{ display: "flex", justifyContent: "center", paddingBottom: "3.5rem" }}>
        <a href="/" aria-label="Back to all trips" style={{ display: "flex" }}>
          <Wordmark size={30} />
        </a>
      </header>
      {/* Back link sits just above the trip title, not hugging the logo. */}
      <header style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <a href="/" className="label" style={{ opacity: 0.6, whiteSpace: "nowrap", alignSelf: "flex-start", marginBottom: "0.4rem" }}>← all trips</a>
        {/* Title left, trip-level "link existing booking" action right. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 400 }}>{it.name}</h1>
          <LinkBookingEditor tripCode={it.tripCode} tripName={it.name} tripRecordId={it.tripRecordId} />
        </div>
        <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", fontFamily: "var(--font-mono), monospace", fontSize: "0.82rem", opacity: 0.7 }}>
          <span>{it.tripCode}</span>
          <span>{dateRange}</span>
          {it.status ? <span>{it.status}</span> : null}
          {it.guests.length ? <span>{it.guests.length} guest{it.guests.length > 1 ? "s" : ""}</span> : null}
        </div>
        {it.guests.length ? (
          <p style={{ margin: 0, opacity: 0.7, fontSize: "0.9rem" }}>
            {it.guests.map((g) => g.name).join(", ")}
          </p>
        ) : null}
        {it.totals.length ? (
          <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.4rem" }}>
            {it.totals.map((t) => (
              <span key={t.currency} className="label" style={{ color: color.blue }}>
                {fmtMoney(t.amount, t.currency)} <span style={{ opacity: 0.5 }}>booked</span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <hr className="hairline" />

      {it.days.map((day) => (
        <section key={day.date} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", margin: "0 0 0.2rem" }}>
            <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 400 }}>{fmtDay(day.date)}</h2>
            <DayAdd date={day.date} tripCode={it.tripCode} tripName={it.name} tripRecordId={it.tripRecordId} />
          </div>
          {day.reservations.length === 0 ? (
            <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: "0.4rem 0 1rem" }}>nothing scheduled</p>
          ) : (
            day.reservations.map((r, i) => (
              <div key={r.id}>
                <ReservationCard r={r} tripCode={it.tripCode} tripName={it.name} />
                {i < day.reservations.length - 1 ? <hr className="hairline" style={{ opacity: 0.35 }} /> : null}
              </div>
            ))
          )}
        </section>
      ))}
    </main>
  );
}
