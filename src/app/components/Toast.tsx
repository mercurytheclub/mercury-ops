"use client";

import { useEffect, useState } from "react";

type Tone = "success" | "error";
type Toast = { id: number; message: string; tone: Tone };

const DURATION = 4200; // ms on screen (matches the progress-bar animation)
let counter = 0;

/** Fire a toast from anywhere on the client (drawer save, etc.). */
export function showToast(message: string, tone: Tone = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mercury-toast", { detail: { id: ++counter, message, tone } }));
}

function Glyph({ tone }: { tone: Tone }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="12" r="9.25" opacity="0.9" />
      {tone === "error" ? (
        <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
      ) : (
        <path d="M8.25 12.25l2.5 2.5 5-5.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** Mounted once in the layout; renders the top-right toast stack. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent).detail as Toast;
      setToasts((cur) => [...cur, t]);
      // Begin the slide-out a beat before removal so it animates off-screen.
      window.setTimeout(() => setLeaving((s) => new Set(s).add(t.id)), DURATION - 320);
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== t.id));
        setLeaving((s) => {
          const n = new Set(s);
          n.delete(t.id);
          return n;
        });
      }, DURATION);
    };
    window.addEventListener("mercury-toast", onToast);
    return () => window.removeEventListener("mercury-toast", onToast);
  }, []);

  return (
    <div className="toast-wrap" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}${leaving.has(t.id) ? " toast-leaving" : ""}`}>
          <span className="toast-icon">
            <Glyph tone={t.tone} />
          </span>
          <div className="toast-body">
            <span className="toast-eyebrow label">{t.tone === "error" ? "couldn’t save" : "saved"}</span>
            <span className="toast-msg">{t.message}</span>
          </div>
          <span className="toast-bar" style={{ animationDuration: `${DURATION}ms` }} />
        </div>
      ))}
    </div>
  );
}
