import type { Metadata } from "next";
import { inconsolata, atkinson } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "mercury ops",
  description: "concierge travel — ops command center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inconsolata.variable} ${atkinson.variable}`}>
      <body>{children}</body>
    </html>
  );
}
