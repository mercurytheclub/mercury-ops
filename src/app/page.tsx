import { loadTrips } from "@/server/airtable";
import { Wordmark } from "./components/Wordmark";
import { TripsList } from "./components/TripsList";

// Server component: reads Airtable directly through the server-only loader.
// No client-side fetch, no token in the browser. The list + search UI is a
// client component (TripsList) hydrated with the loaded trips.
// ISR: cached + revalidated every 60s so the list loads instantly.
export const revalidate = 60;

export default async function Home() {
  const trips = await loadTrips();

  return (
    <main style={{ minHeight: "100vh", padding: "6vh 6vw", display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <header style={{ display: "flex", justifyContent: "center", paddingBottom: "0.5rem" }}>
        <Wordmark size={30} />
      </header>

      {trips.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          no trips loaded. set <code>AIRTABLE_TOKEN</code> in <code>.env.local</code> and reload.
        </p>
      ) : (
        <TripsList trips={trips} />
      )}
    </main>
  );
}
