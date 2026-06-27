"use client";

import { useEffect, useState } from "react";

// One-time, brand-restrained greeting shown right after sign-in. The login
// redirect lands on "/?welcome=1"; this reads the session name, greets by time
// of day, then cleans the URL so a refresh doesn't repeat it.
//
// Anchored to the top-left gutter (mirrors "sign out" at top-right) rather than
// floating center — no pill, no glass, just a mono kicker + Atkinson line with
// the name in the single cyan accent, under a hairline that draws in.
//
// Module-level guard so React's strict-mode double-mount (dev) can't fire it
// twice or have the first run strip the ?welcome param before the second reads it.
let welcomed = false;

export function Welcome() {
  const [data, setData] = useState<{ greeting: string; name: string } | null>(null);
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
        const name = full ? full.split(/\s+/)[0] : "";
        const h = new Date().getHours();
        const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
        setData({ greeting, name });
        window.setTimeout(() => setLeaving(true), 4200);
        window.setTimeout(() => setData(null), 4800);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;
  return (
    <div className={`welcome${leaving ? " welcome-leaving" : ""}`} role="status" aria-live="polite">
      <span className="welcome-kicker">welcome back</span>
      <span className="welcome-line">
        {data.greeting}
        {data.name ? (
          <>
            , <span className="welcome-name">{data.name}</span>
          </>
        ) : null}
      </span>
      <span className="welcome-rule" aria-hidden />
    </div>
  );
}
