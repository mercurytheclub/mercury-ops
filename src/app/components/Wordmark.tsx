import { color } from "@brand";

// The official Mercury wordmark from mercurytheclub.com (vendored at
// public/mercury-logo-white.svg), paired with the cyan "ops" tag that marks
// this as the ops surface. `size` is the logo height in px at desktop width;
// it scales down on narrow viewports (clamp) so the mark never clips, while
// staying exactly `size` on any screen wider than ~545px.
export function Wordmark({ size = 26 }: { size?: number }) {
  const logoH = `clamp(${Math.round(size * 0.6)}px, 5.5vw, ${size}px)`;
  const opsFont = `clamp(${Math.round(size * 0.6 * 0.62)}px, 3.4vw, ${Math.round(size * 0.62)}px)`;
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: `${Math.round(size * 0.5)}px`, maxWidth: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mercury-logo-white.svg"
        alt="mercury"
        style={{ height: logoH, width: "auto", display: "block" }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontSize: opsFont,
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
