import { loadItinerary } from "@/server/itinerary";
import type { Reservation } from "@/server/itinerary";
import { color } from "@brand";
import { Wordmark } from "@/app/components/Wordmark";
import { notFound } from "next/navigation";

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

function ReservationCard({ r }: { r: Reservation }) {
  const time = timeOf(r.startAt);
  const a = r.admin;
  const hasAdmin = a.cost.length || a.supplier || a.contact || a.locator || a.notes;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "5.5rem 1fr", gap: "0 1.25rem", padding: "1.1rem 0" }}>
      <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.8rem", opacity: 0.6, paddingTop: "0.15rem" }}>
        {time || "—"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <span className="label" style={{ color: color.blue, opacity: 0.9 }}>{CATEGORY_LABEL[r.category]}</span>
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
      {/* Nav bar: 3 columns so the back action (left) and centered logo never
          overlap — the empty right column balances the grid to keep it centered.
          paddingBottom gives the masthead the same breathing room as the All
          Trips page before the content begins. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "1.5rem", paddingBottom: "3rem" }}>
        <a href="/" className="label" style={{ justifySelf: "start", opacity: 0.6, whiteSpace: "nowrap" }}>← all trips</a>
        <a href="/" aria-label="Back to all trips" style={{ display: "flex", justifySelf: "center" }}>
          <Wordmark size={30} />
        </a>
        <span aria-hidden />
      </div>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 400 }}>{it.name}</h1>
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
          <h2 style={{ margin: "0 0 0.2rem", fontSize: "0.95rem", fontWeight: 400 }}>
            {fmtDay(day.date)}
          </h2>
          {day.reservations.length === 0 ? (
            <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: "0.4rem 0 1rem" }}>nothing scheduled</p>
          ) : (
            day.reservations.map((r, i) => (
              <div key={r.id}>
                <ReservationCard r={r} />
                {i < day.reservations.length - 1 ? <hr className="hairline" style={{ opacity: 0.35 }} /> : null}
              </div>
            ))
          )}
        </section>
      ))}
    </main>
  );
}
