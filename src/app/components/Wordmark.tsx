import { brand, color } from "@brand";

// Matches the mobile app's masthead wordmark (app/app/index.tsx): MERCURY in
// uppercase Inconsolata with wide letter-spacing, white at 90%. The cyan "ops"
// suffix marks this as the ops surface.
export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.55em" }}>
      <span
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontSize: size,
          fontWeight: 400,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.9)",
        }}
      >
        {brand.wordmark}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontSize: Math.round(size * 0.62),
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: color.blue,
          opacity: 0.9,
        }}
      >
        ops
      </span>
    </span>
  );
}
