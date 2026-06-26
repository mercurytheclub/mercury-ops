// Full-screen brand loader — plays the white Mercury logo animation
// (public/mercury-white.mp4, sourced from the brand assets) on a black stage.
// Used as the route-transition fallback (loading.tsx) and the initial splash.
// Plain element so it can render server-side in a Suspense fallback.
export function MercuryLoader({ fading = false }: { fading?: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#070707",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fading ? 0 : 1,
        transition: "opacity 450ms ease",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <video
        src="/mercury-white.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        // The clip is a white wordmark on a pure-black (#000) frame; the stage is
        // #070707, so the raw video reads as a slightly-darker square. `screen`
        // blends pure black into the backdrop (black → transparent) while keeping
        // the white logo, so the frame disappears into the stage seamlessly.
        style={{ width: "min(46vw, 230px)", height: "auto", display: "block", mixBlendMode: "screen" }}
      />
    </div>
  );
}
