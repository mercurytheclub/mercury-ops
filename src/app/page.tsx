import { loadTrips, type OpsTrip } from "@/server/airtable";
import { color } from "@brand";
import { Wordmark } from "./components/Wordmark";

// Server component: reads Airtable directly through the server-only loader.
// No client-side fetch, no token in the browser.
export const dynamic = "force-dynamic";

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

export default async function Home() {
  const trips = await loadTrips();

  return (
    <main style={{ minHeight: "100vh", padding: "6vh 6vw", display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <header style={{ display: "flex", justifyContent: "center", paddingBottom: "0.5rem" }}>
        <Wordmark size={20} />
      </header>

      {trips.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          no trips loaded. set <code>AIRTABLE_TOKEN</code> in <code>.env.local</code> and reload.
        </p>
      ) : (
        GROUPS.map(({ key, label }) => {
          const group = trips.filter((t) => t.timeframe === key);
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
    </main>
  );
}
