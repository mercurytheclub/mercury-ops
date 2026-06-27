import { loadAgenda } from "@/server/agenda";
import { Wordmark } from "@/app/components/Wordmark";
import { SignOut } from "@/app/components/SignOut";
import { color } from "@brand";

// Cross-trip data, recomputed often — keep it fresh.
export const revalidate = 60;

const RANGES = { today: 1, week: 7, month: 30 } as const;
type RangeKey = keyof typeof RANGES;
const RANGE_LABEL: Record<RangeKey, string> = { today: "today", week: "next 7 days", month: "next 30 days" };

function addDays(isoDate: string, n: number): string {
  return new Date(new Date(isoDate + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDay(date: string, today: string): string {
  const d = new Date(date + "T00:00:00Z");
  const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  if (date === today) return `Today · ${label}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}
function timeOf(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string }>;
}) {
  const sp = await searchParams;
  const range: RangeKey = sp.range === "today" || sp.range === "month" ? sp.range : "week";
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : todayISO();
  const to = addDays(from, RANGES[range] - 1);
  const today = todayISO();

  const days = await loadAgenda(from, to);
  const total = days.reduce((n, d) => n + d.items.length, 0);

  return (
    <main style={{ minHeight: "100vh", padding: "6vh 6vw", display: "flex", flexDirection: "column", gap: "2.5rem", maxWidth: 920, margin: "0 auto" }}>
      <SignOut />
      <header style={{ display: "flex", justifyContent: "center", paddingBottom: "0.5rem" }}>
        <Wordmark size={30} />
      </header>

      {/* Trips ↔ Today tabs */}
      <nav style={{ display: "flex", justifyContent: "center", gap: "1.75rem" }}>
        <a href="/" className="label" style={{ opacity: 0.5 }}>trips</a>
        <span className="label" style={{ color: color.blue }}>today</span>
      </nav>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 400 }}>Operations</h1>
          <span className="label" style={{ opacity: 0.5 }}>{total} item{total === 1 ? "" : "s"} · {RANGE_LABEL[range]}</span>
        </div>
        {/* Range pills */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <a key={k} href={`/today?range=${k}${sp.from ? `&from=${sp.from}` : ""}`} className={`agenda-pill${k === range ? " agenda-pill-on" : ""}`}>
              {RANGE_LABEL[k]}
            </a>
          ))}
        </div>
      </div>

      <hr className="hairline" />

      {total === 0 ? (
        <p style={{ opacity: 0.4, fontSize: "0.9rem" }}>nothing scheduled in this window.</p>
      ) : (
        days.map((day) => (
          <section key={day.date} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <h2 style={{ margin: "0 0 0.4rem", fontSize: "1rem", fontWeight: 400 }}>{fmtDay(day.date, today)}</h2>
            {day.items.map((it) => (
              <a key={it.id} href={`/trip/${encodeURIComponent(it.tripCode)}`} className="agenda-row">
                <span className="agenda-time">{it.time ? timeOf(it.startAt) : "—"}</span>
                <span className="agenda-body">
                  <span className="label agenda-cat" style={{ color: color.blue }}>{it.label}</span>
                  <span className="agenda-title">{it.title}</span>
                  <span className="agenda-meta">
                    {[it.guest, it.tripName].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="agenda-trip label">{it.tripCode}</span>
              </a>
            ))}
          </section>
        ))
      )}
    </main>
  );
}
