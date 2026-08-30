import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadThreadDetail, serverConfigured } from "@/server/concierge";
import { Wordmark } from "@/app/components/Wordmark";
import { ThreadView } from "@/app/components/ThreadView";
import { TripPanel } from "@/app/components/TripPanel";

// Always fresh. A cached transcript can be missing the text the guest sent ten
// seconds ago, and answering the wrong message is worse than a slower page.
export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const detail = await loadThreadDetail(threadId);
  if (!detail) notFound();

  return (
    <main className="cx-page">
      <header className="cx-page-head">
        <a href="/inbox" className="cx-back label">
          back to inbox
        </a>
        <Wordmark size={30} />
        <span aria-hidden />
      </header>

      <ThreadView
        detail={detail}
        canSendNow={serverConfigured()}
        // Streamed in its own boundary: the trip panel reads every booking table
        // for the guest's trip, and the conversation must never wait on that.
        trip={
          <Suspense fallback={<p className="cx-context-empty">Loading their trip…</p>}>
            <TripPanel guestId={detail.thread.guestId} />
          </Suspense>
        }
      />
    </main>
  );
}
