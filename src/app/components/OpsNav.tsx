import { color } from "@brand";

// The three ops surfaces. Extracted when the inbox arrived — the same row was
// being written by hand on every page and the third entry made that a liability.

const TABS = [
  { key: "trips", label: "trips", href: "/" },
  { key: "today", label: "today", href: "/today" },
  { key: "inbox", label: "inbox", href: "/inbox" },
] as const;

export type OpsTab = (typeof TABS)[number]["key"];

export function OpsNav({ current }: { current: OpsTab }) {
  return (
    <nav
      style={{
        display: "flex",
        justifyContent: "center",
        gap: "1.75rem",
        marginTop: "-1.25rem",
        alignItems: "baseline",
      }}
    >
      {TABS.map((t) =>
        t.key === current ? (
          <span key={t.key} className="label" style={{ color: color.blue }}>
            {t.label}
          </span>
        ) : (
          <a key={t.key} href={t.href} className="label" style={{ opacity: 0.5 }}>
            {t.label}
          </a>
        ),
      )}
    </nav>
  );
}
