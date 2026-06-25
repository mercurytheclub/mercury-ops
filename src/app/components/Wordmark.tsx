import { color } from "@brand";

// The official Mercury wordmark from mercurytheclub.com (vendored at
// public/mercury-logo-white.svg), paired with the cyan "ops" tag that marks
// this as the ops surface. `size` is the logo height in px.
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: `${Math.round(size * 0.5)}px` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mercury-logo-white.svg"
        alt="mercury"
        height={size}
        style={{ height: size, width: "auto", display: "block" }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontSize: Math.round(size * 0.62),
          lineHeight: 1,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: color.blue,
          opacity: 0.9,
          paddingBottom: Math.round(size * 0.06),
        }}
      >
        ops
      </span>
    </span>
  );
}
