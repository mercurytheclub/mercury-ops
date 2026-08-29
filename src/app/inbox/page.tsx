import { loadThreads } from "@/server/concierge";
import { Wordmark } from "@/app/components/Wordmark";
import { OpsNav } from "@/app/components/OpsNav";
import { ThreadList } from "@/app/components/ThreadList";

// A live reply queue. Short window, and the list also refreshes itself on the
// client — a concierge looking at a stale inbox is the failure that matters
// here, not a few extra Airtable reads.
export const revalidate = 15;

export default async function InboxPage() {
  const threads = await loadThreads();

  return (
    <main style={{ minHeight: "100vh", padding: "6vh 6vw", display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <header style={{ display: "flex", justifyContent: "center", paddingBottom: "0.5rem" }}>
        <Wordmark size={30} />
      </header>

      <OpsNav current="inbox" />

      {threads.length === 0 ? (
        <p style={{ opacity: 0.6, maxWidth: "48ch" }}>
          No guest has texted the concierge line yet. When one does, the thread appears here and the
          ops WhatsApp group gets a nudge at the same time.
        </p>
      ) : (
        <ThreadList threads={threads} />
      )}
    </main>
  );
}
