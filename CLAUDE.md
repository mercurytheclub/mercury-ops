# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**mercury-ops** — the internal web command center for Mercury's concierge team (Next.js App Router + React + TypeScript). Mercury is a UHNW luxury travel concierge in Los Angeles. This app is for the **ops team**, not guests; the guest-facing app is the separate `mercury-consumer` repo.

Like the consumer app, **Airtable is the source of truth** — the ops team writes itineraries there. This app reads (and eventually writes) Airtable through a server boundary; the browser must never hold the Airtable token. As of scaffold, only the brand-wired shell exists; the data layer is not built yet.

## Commands
```bash
npm install            # first; also pulls the brand submodule (see below)
npm run dev            # next dev — local at http://localhost:3000
npm run build          # next build (production)
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
```

## Brand is a submodule — do not copy tokens in

The Mercury identity is the single-source-of-truth repo `mercury-brand`, mounted here as a git submodule at **`vendor/brand`**. Color, type, logos, and fonts all come from there.

- After cloning: `git submodule update --init --recursive` (or `npm install`, which the team can wire to do it). The submodule URL is **relative** (`../mercury-brand`), so it resolves to `git@github.com:mercurytheclub/mercury-brand.git` once both repos live under the org.
- Consume tokens via the `@brand` path alias (→ `vendor/brand/tokens.ts`) for typed `color`/`font`/`brand`, and `vendor/brand/tokens.css` for the `--mercury-*` CSS variables (imported once in `src/app/globals.css`).
- Fonts load via `next/font/local` in `src/app/fonts.ts`, pointing at `vendor/brand/fonts/*.ttf`.
- **Never redefine a color/font/wordmark locally.** If a token needs to change, change it in the `mercury-brand` repo, bump its version, and update the submodule pointer here (`git -C vendor/brand pull && git add vendor/brand`).

## Design rules (from the founder — non-negotiable)
- Stage black `#070707` dominates (~80%); cyan `#52A5D3` is the **single** accent, used sparingly. Red = alert, green = success.
- Wordmark **lowercase** "mercury", tagline "concierge travel". Mono micro-labels (Inconsolata, uppercase, e.g. FLIGHT). Body copy in Atkinson Hyperlegible.
- Hairlines, not borders. No oversized icons, no glowing outlines. No guest-facing codes/abbreviations (FLIGHT not FL), full names always, no concierge clichés, no filler copy. When unsure, show less.

## Structure
- `src/app/` — Next.js App Router (`layout.tsx` mounts fonts + globals; `page.tsx` is the brand-wired shell).
- `vendor/brand/` — the `mercury-brand` submodule. Treat as read-only from here.
- Path aliases (`tsconfig.json`): `@/*` → `src/*`, `@brand` → the brand tokens.

## Not yet built (expected next)
Airtable data access through a server boundary (mirror `mercury-consumer/server`), auth for ops users, and the ops surfaces themselves (itinerary builder, guest/trip management). When adding the data layer, reference tables by **ID** not name, as the consumer server does.
