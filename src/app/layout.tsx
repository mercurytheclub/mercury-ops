import type { Metadata } from "next";
import { inconsolata, atkinson } from "./fonts";
import { InitialLoader } from "./components/InitialLoader";
import { Toaster } from "./components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mercury | Ops",
  description: "concierge travel — ops command center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inconsolata.variable} ${atkinson.variable}`}>
      <body>
        <InitialLoader />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
