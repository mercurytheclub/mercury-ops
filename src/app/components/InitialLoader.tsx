"use client";

import { useEffect, useState } from "react";
import { MercuryLoader } from "./MercuryLoader";

// Brand splash on first load, mirroring mercurytheclub.com's preloader. Rendered
// server-side too (defaults to visible), so the animation shows on the very
// first paint; once the page has loaded — and after a short minimum so the
// animation reads — it fades out and unmounts. Route-to-route navigation uses
// the loading.tsx fallback instead (this only runs once per full page load).
const MIN_VISIBLE_MS = 1500;
const FADE_MS = 450;

export function InitialLoader() {
  const [show, setShow] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const start = performance.now();
    let fadeTimer: ReturnType<typeof setTimeout>;
    let doneTimer: ReturnType<typeof setTimeout>;

    const dismiss = () => {
      const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - start));
      fadeTimer = setTimeout(() => {
        setFading(true);
        doneTimer = setTimeout(() => setShow(false), FADE_MS);
      }, wait);
    };

    if (document.readyState === "complete") dismiss();
    else window.addEventListener("load", dismiss, { once: true });

    return () => {
      window.removeEventListener("load", dismiss);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (!show) return null;
  return <MercuryLoader fading={fading} />;
}
