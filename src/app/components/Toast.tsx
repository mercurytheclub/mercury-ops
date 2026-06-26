"use client";

import { useEffect, useState } from "react";

type Tone = "success" | "error";
type Toast = { id: number; message: string; tone: Tone };

let counter = 0;

/** Fire a toast from anywhere on the client (drawer save, etc.). */
export function showToast(message: string, tone: Tone = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mercury-toast", { detail: { id: ++counter, message, tone } }));
}

/** Mounted once in the layout; renders the toast stack and auto-dismisses. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent).detail as Toast;
      setToasts((cur) => [...cur, t]);
      window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 3400);
    };
    window.addEventListener("mercury-toast", onToast);
    return () => window.removeEventListener("mercury-toast", onToast);
  }, []);

  return (
    <div className="toast-wrap" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span className="toast-icon">{t.tone === "error" ? "✕" : "✓"}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
