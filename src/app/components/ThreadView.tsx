"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConciergeMessage, ThreadDetail } from "@/server/concierge";
import { claimThreadAction, redraftAction, saveDraftAction, sendReplyAction } from "@/app/concierge-actions";
import { showToast } from "./Toast";
import { clockOf, dayOf, waitedFor } from "@/lib/waited";

// One conversation: the transcript, what Claude drafted, and the one button that
// texts a real person.
//
// The draft is the point of this screen. Claude writes three things and only one
// of them is the reply: `Draft Unresolved` is a list of facts it could not
// establish, each one a blank a concierge has to fill before this is safe to
// send. So unresolved lines are rendered ABOVE the composer, not below it, and
// they are the only thing on the page allowed to use the alert colour.

const REFRESH_MS = 20_000;
/** Twilio splits past this; the server refuses past its own limit anyway. */
const SOFT_LIMIT = 480;

function statusTone(status: string | null): string {
  switch (status) {
    case "Delivered":
      return "cx-pill-good";
    case "Failed":
    case "Draft Failed":
      return "cx-pill-bad";
    case "Sent":
    case "Queued":
    case "Drafting":
      return "cx-pill-wait";
    default:
      return "";
  }
}

/**
 * Which statuses are worth a pill on a bubble.
 *
 * `Delivered` and `Received` are the expected outcomes and stay silent — a pill
 * on every message is noise nobody reads. Everything else is a state a concierge
 * should notice, and that now includes **Sent**: since the delivery callback
 * landed, `Sent` means Twilio accepted it and has not yet confirmed it reached a
 * handset. Showing it as a quiet in-flight pill is the honest reading, and it is
 * what stops a failed text looking answered — which is exactly what happened to
 * two replies that sat at `Sent` for eight days after the carrier rejected them.
 */
function showsPill(status: string | null): boolean {
  return Boolean(status) && status !== "Delivered" && status !== "Received";
}

export function ThreadView({
  detail,
  canSendNow,
  trip,
}: {
  detail: ThreadDetail;
  canSendNow: boolean;
  /** The guest's trip, rendered on the server and streamed in. Passed as a slot
   *  so this client component never has to load it. */
  trip: React.ReactNode;
}) {
  const router = useRouter();
  const { thread, messages, replyTo } = detail;

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  // Poll for the guest's next text, but never while the concierge is mid-word:
  // router.refresh() would re-render the composer under them. `dirty` holds it.
  const [text, setText] = useState(replyTo?.draftReply ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Open on the newest message, not the oldest. The transcript is its own
  // scroller, so without this a thread that has run for weeks opens on a text
  // from a fortnight ago and the concierge answers the wrong thing.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!dirty && !pending) router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router, dirty, pending]);

  // A new draft arriving from the server (a redraft finishing, or a fresh text)
  // replaces the box only when the concierge has not touched it.
  useEffect(() => {
    if (!dirty) setText(replyTo?.draftReply ?? "");
  }, [replyTo?.id, replyTo?.draftReply, dirty]);

  const unresolved = useMemo(
    () =>
      (replyTo?.draftUnresolved ?? "")
        .split("\n")
        .map((l) => l.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean),
    [replyTo?.draftUnresolved],
  );

  const waited = now && thread.lastMessageAt && thread.awaitingReply ? waitedFor(thread.lastMessageAt, now) : null;
  const tooLong = text.trim().length > SOFT_LIMIT;

  function handleSend() {
    if (!replyTo) return;
    const body = text.trim();
    if (!body) return;
    startTransition(async () => {
      const res = await sendReplyAction({ threadId: thread.id, messageId: replyTo.id, text: body });
      if (!res.ok) {
        showToast(res.error, "error", "didn’t send");
        return;
      }
      setDirty(false);
      setSent(true);
      if (res.sent) showToast("Text delivered to the guest.", "success", "sent");
      else showToast(res.note, "success", "queued");
      router.refresh();
    });
  }

  function handleSave() {
    if (!replyTo) return;
    startTransition(async () => {
      const res = await saveDraftAction({ threadId: thread.id, messageId: replyTo.id, text });
      if (res.ok) {
        setDirty(false);
        showToast("Draft saved. Nothing has gone to the guest.", "success", "saved");
      } else showToast(res.error ?? "Could not save the draft.", "error");
    });
  }

  function handleRedraft() {
    if (!replyTo) return;
    startTransition(async () => {
      const res = await redraftAction({ threadId: thread.id, messageId: replyTo.id });
      if (res.ok) {
        setDirty(false);
        showToast("Claude is writing a new draft. It takes a moment.", "success", "redrafting");
        setTimeout(() => router.refresh(), 6000);
      } else showToast(res.error ?? "Could not start a redraft.", "error");
    });
  }

  function handleClaim(release: boolean) {
    startTransition(async () => {
      const res = await claimThreadAction({ threadId: thread.id, release });
      if (res.ok) router.refresh();
      else showToast(res.error ?? "Could not update the claim.", "error");
    });
  }

  return (
    <div className="cx-thread">
      {/* ── left: who, and what they are in the middle of ─────────────── */}
      <aside className="cx-aside">
        <div className="cx-guest">
          <h1 className="cx-guest-name">{thread.guestName ?? thread.title}</h1>
          {thread.phone && <a href={`tel:${thread.phone}`} className="cx-guest-phone">{thread.phone}</a>}
          <div className="cx-guest-tags">
            {thread.status && <span className="cx-tag">{thread.status}</span>}
            {thread.optedOut && <span className="cx-tag cx-tag-stop">opted out of SMS</span>}
          </div>
        </div>

        {thread.optedOut && (
          <p className="cx-warn">
            This guest texted STOP. Nothing can be sent to them until they text START. Call them
            instead.
          </p>
        )}

        <div className="cx-claim">
          {thread.claimedBy ? (
            <>
              <span className="label cx-claim-who">{thread.claimedBy} is on this</span>
              <button className="cx-btn-ghost" onClick={() => handleClaim(true)} disabled={pending}>
                release
              </button>
            </>
          ) : (
            <button className="cx-btn-ghost" onClick={() => handleClaim(false)} disabled={pending}>
              I’ll take this one
            </button>
          )}
        </div>

        {trip}
      </aside>

      {/* ── right: the conversation, then the draft ───────────────────── */}
      <section className="cx-convo">
        <div className="cx-transcript" ref={transcriptRef}>
          {messages.length === 0 && <p className="cx-context-empty">No messages on this thread yet.</p>}
          {messages.map((m, i) => {
            const prevDay = i > 0 ? dayOf(messages[i - 1].sentAt ?? messages[i - 1].createdTime, now ?? 0) : null;
            const thisDay = dayOf(m.sentAt ?? m.createdTime, now ?? 0);
            return (
              <Fragment key={m.id}>
                {now !== null && thisDay && thisDay !== prevDay && (
                  <div className="cx-daybreak">
                    <span>{thisDay}</span>
                  </div>
                )}
                <Bubble message={m} />
              </Fragment>
            );
          })}
        </div>

        <div className="cx-composer">
          {waited && (
            <div className={`cx-waiting-banner${waited.minutes >= 15 ? " cx-waiting-late" : ""}`}>
              Waiting {waited.text} for a reply.
            </div>
          )}

          {!replyTo ? (
            <p className="cx-context-empty cx-no-reply">
              There is nothing to reply to yet. A reply hangs off a message the guest sent, so
              starting a text to a guest who has not written first is not possible from here.
            </p>
          ) : (
            <>
              {unresolved.length > 0 && (
                <div className="cx-unresolved">
                  <span className="label cx-unresolved-head">fill these in before sending</span>
                  <ul>
                    {unresolved.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {replyTo.draftNote && (
                <p className="cx-note">
                  <span className="label cx-note-head">claude’s note</span>
                  {replyTo.draftNote}
                </p>
              )}

              {replyTo.error && <p className="cx-error">{replyTo.error}</p>}

              <textarea
                ref={composerRef}
                className="cx-input"
                value={text}
                rows={5}
                placeholder={
                  replyTo.status === "Drafting"
                    ? "Claude is still writing a draft. You can write your own instead."
                    : "Write the reply that goes to the guest."
                }
                onChange={(e) => {
                  setText(e.target.value);
                  setDirty(true);
                  setSent(false);
                }}
                aria-label="Reply to the guest"
              />

              <div className="cx-composer-foot">
                <span className={`cx-count${tooLong ? " cx-count-over" : ""}`}>
                  {text.trim().length} characters
                  {replyTo.draftModel && !dirty ? ` · drafted by ${replyTo.draftModel}` : ""}
                </span>

                <div className="cx-actions">
                  <button className="cx-btn-ghost" onClick={handleRedraft} disabled={pending || !canSendNow}>
                    redraft
                  </button>
                  <button className="cx-btn-ghost" onClick={handleSave} disabled={pending || !dirty}>
                    save draft
                  </button>
                  <button
                    className="cx-btn-send"
                    onClick={handleSend}
                    disabled={pending || !text.trim() || thread.optedOut || sent}
                  >
                    {pending ? "sending…" : sent ? "sent" : "send to guest"}
                  </button>
                </div>
              </div>

              {!canSendNow && (
                <p className="cx-context-empty">
                  Sending will tick the box in Airtable and the existing automation will deliver it.
                  Set MERCURY_APP_KEY and CONCIERGE_OPS_SECRET here to send immediately and see the
                  result on this screen.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Bubble({ message }: { message: ConciergeMessage }) {
  const mine = message.direction === "Outbound";
  return (
    <div className={`cx-bubble-row${mine ? " cx-bubble-mine" : ""}`}>
      <div className="cx-bubble">
        <p className="cx-bubble-body">{message.body || <em>empty message</em>}</p>
        {message.status === "Failed" && message.error && (
          <p className="cx-bubble-error">{message.error}</p>
        )}
        <span className="cx-bubble-meta">
          {clockOf(message.sentAt ?? message.createdTime)}
          {message.channel && message.channel !== "SMS" ? ` · ${message.channel}` : ""}
          {showsPill(message.status) ? (
            <span className={`cx-pill ${statusTone(message.status)}`}>{message.status}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
