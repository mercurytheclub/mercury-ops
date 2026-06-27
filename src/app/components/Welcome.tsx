"use client";

import { useEffect, useState } from "react";

// One-time personalized greeting shown right after sign-in. The login redirect
// lands on "/?welcome=1"; this reads the session name, greets by time of day,
// then cleans the URL so a refresh doesn't repeat it.
//
// Module-level guard so React's strict-mode double-mount (dev) can't fire it
// twice or have the first run strip the ?welcome param before the second reads it.
let welcomed = false;

export function Welcome() {
  const [text, setText] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (welcomed) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("welcome") !== "1") return;
    welcomed = true;
    url.searchParams.delete("welcome");
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));

    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => {
        const full = ((s?.user?.name as string) || "").trim();
        const first = full ? full.split(/\s+/)[0] : "";
        const h = new Date().getHours();
        const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
        setText(first ? `${greeting}, ${first}` : `${greeting} — welcome back`);
        window.setTimeout(() => setLeaving(true), 3600);
        window.setTimeout(() => setText(null), 4100);
      })
      .catch(() => {});
  }, []);

  if (!text) return null;
  return (
    <div className={`welcome${leaving ? " welcome-leaving" : ""}`} role="status" aria-live="polite">
      <span className="welcome-spark" aria-hidden>✦</span>
      <span>{text}</span>
    </div>
  );
}
