import { brand, color } from "@brand";

// Brand values come from the single source of truth (vendor/brand). This page
// proves the wiring: wordmark in mono lowercase, cyan as the single accent.
export default function Home() {
  return (
    <main style={{ minHeight: "100vh", padding: "10vh 8vw", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <span className="label" style={{ color: color.blue }}>ops</span>
      <h1 style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 400, fontSize: "clamp(2.5rem, 8vw, 5rem)", margin: 0, textTransform: "lowercase" }}>
        {brand.wordmark}
      </h1>
      <p style={{ margin: 0, color: "var(--mercury-white)", opacity: 0.7 }}>{brand.tagline}</p>
      <hr className="hairline" style={{ width: "100%", marginTop: "2rem" }} />
    </main>
  );
}
