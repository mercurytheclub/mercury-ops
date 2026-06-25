import localFont from "next/font/local";

// Fonts come from the brand submodule (vendor/brand) — never vendor copies here.
// Exposed as CSS variables consumed in globals.css / layout.

export const inconsolata = localFont({
  src: "../../vendor/brand/fonts/Inconsolata-VariableFont_wdth-wght.ttf",
  variable: "--font-mono",
  display: "swap",
});

export const atkinson = localFont({
  src: [
    { path: "../../vendor/brand/fonts/Atkinson-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../vendor/brand/fonts/Atkinson-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});
