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

## Data layer (Airtable, server-only)

All Airtable access lives in **`src/server/airtable.ts`**, which begins with `import "server-only"` — it can never be pulled into a client bundle, so the `AIRTABLE_TOKEN` never reaches the browser. This mirrors `mercury-consumer/server/src/airtable.ts`; the helpers (paginated `fetchAllPages`, single-flight SWR `makeCached`, `linkedIds`) are ported from it so the two stay consistent.

- **Tables are referenced by ID**, not name (`Trips` = `tblmESP7ooV2ZWSr6`, `Guest Information` = `tblXcehCFamvNdOae`, base `app6LKGIKc3rUeHiP`). Names/emoji change; IDs don't.
- `loadTrips()` returns the lean `OpsTrip[]` (code, name, dates, lead guest resolved via the guests map, guest count, status, derived `timeframe`). Cached + de-duped.
- Consumed two ways: the home server component (`src/app/page.tsx`, `force-dynamic`) renders the list directly; `GET /api/trips` returns the same data as JSON.
- **Setup:** copy `.env.local.example` → `.env.local` and set `AIRTABLE_TOKEN` (read scope, same base as the consumer). Without it, loaders return empty and the UI shows a "set the token" prompt — no crash.
- Don't shape new schemas that duplicate Airtable; an itinerary is the projection of all reservations sharing a Trip Code, exactly as in the consumer app.

### Per-trip itinerary (`src/server/itinerary.ts`)

`loadItinerary(tripCode)` builds the full day-by-day itinerary for one trip and is rendered at **`/trip/[tripCode]`** (also `GET /api/trips/[tripCode]` as JSON). This is the link target from the Airtable interface: `https://<ops-host>/trip/TR00000001`.

- **This is the admin view** — unlike the guest app, every card carries an `admin` block with internal fields: cost lines (e.g. flight `Net Cost (Internal Only)`, hotel `BC/GPC Grand Total`, villa `Grand Total`), `supplier`, `contact` (driver/operator name + phone), `locator` (PNR/record locator/confirmation), and `notes`. The trip header rolls these up into per-currency totals.
- **A booking can belong to more than one trip.** `Trip ID` is a multi-valued link (two households sharing one car keep separate itineraries), so `tripFilter()` matches by MEMBERSHIP: `FIND(",<code>,", "," & SUBSTITUTE(ARRAYJOIN({Trip ID}), ", ", ",") & ",")`. Comma-wrapped so `TR00000022` can't match `TR00000221`. The old `ARRAYJOIN({Trip ID})="<code>"` equality made a two-trip booking vanish from **both** trips. **ARRAYJOIN's separator argument is a no-op on a link field** — Airtable coerces it to text `"TR00000220, TR00000221"` (comma+SPACE) first, which is why the `SUBSTITUTE` is load-bearing and not decoration. Never key anything off `linkedIds(f["Trip ID"])[0]`. **Linking shares, it does not move** — `linkBooking` read-modify-writes the link field to ADD this trip, so `link`/`unlink` are exact inverses and neither ever touches another trip's itinerary. A shared booking's date is **not** editable from the picker: one record sits behind both days, so re-dating it there would move it for the other household (the server ignores the date on an already-shared booking, whatever the UI sent).
- **Adding a booking category = one loader.** Write a `Loader` that reads its table, filters by linked `Trip ID`, and returns `Reservation[]`, then add it to `CATEGORY_LOADERS`. Currently implemented: flights, hotels, villas, car service, restaurants, activities. Not yet: private flights, cruises, yachts, trains, helicopters, greeters, VIP terminals/events (~12 more tables — same pattern).
- **Names come from the master when the booking's denorm text is blank** — `nameMapLoader` resolves the linked Hotels/Restaurants/Activities master so a card never shows a generic "Hotel".
- Dates/times are folded with `combineDateTime` into floating local ISO (no timezone) — the wall clock at the booking's location is the source of truth; render verbatim, never convert to the viewer's zone.
- **Open data question:** the hotel "guest price" cost line is labelled `USD` by assumption (`GPC - Grand Total`); confirm the real currency before trusting it. Some booking rows have empty `Hotel Name`/guest links — handled gracefully (master fallback / trip-level guests).

### Concierge inbox (`src/server/concierge.ts`, `/inbox`)

Where ops read and answer the guest SMS line. Guests text Mercury's Twilio number; **mercury-server owns everything that happens next** (matches the number to a guest, stores the message, nudges the ops WhatsApp group, asks Claude Opus 5 for a reply draft) — see `mercury-consumer/docs/CONCIERGE_CHAT.md`. This app adds **no new system of record**: it is a better lens on the two Airtable tables the engine already writes, and the Airtable interface keeps working alongside it.

- **Two tables, addressed by field ID.** `💬 Concierge Threads` (`tbl1TC0d6GyvPW61j`, one row per guest) and `💬 Concierge Messages` (`tblpHhgvUfn49GcE0`, one row per message). Every read passes `returnFieldsByFieldId=true` and the ids live in the `T` / `M` maps at the top of the file. **Never switch these to field names** — a rename would read every thread as empty, silently, and Airtable renames have already broken this base twice. Field ids cannot protect `filterByFormula` (it can only reference names), so no read filters on a field: threads are read whole and filtered in memory, messages are addressed by `RECORD_ID()` alone.
- **Sending.** `sendReply` writes `Draft Reply` + ticks `Send`, then POSTs `mercury-server /internal/concierge/send` for a real verdict. That route is behind **two** headers (`x-mercury-key` AND `x-internal-secret`); one without the other is a 401. It is safe to race the deployed `Concierge — send reply` Airtable automation on the same checkbox because mercury-server unticks `Send` before calling Twilio, so the loser reads it as false and refuses. Without the secrets set, send falls back to ticking the box and says so rather than claiming a delivery it did not witness.
- **`Send` is unticked by us on `unauthorized` / `bad_message_id`.** Those two are refused by the guards in front of the route, before it reads the record — so unlike every other failure the server does *not* clean up after itself, and a still-ticked box would have the automation deliver a text the concierge was just told had failed.
- **`Unread` is a reply queue, not a seen flag.** mercury-server sets it on every inbound and clears it only on a successful send. It cannot say whether someone is already writing the reply, which is what **`Claimed By` / `Claimed At`** are for — added for this inbox, written only here, and deliberately a hint rather than a lock so a forgotten claim can never block a send.
- **The trip panel is cached hard and streamed.** `loadGuestContext` runs `loadItinerary`, which fans out across every booking table. The thread page re-renders every 20 seconds while a concierge sits on it, so uncached this would be ~17 Airtable reads every 20s against a base limited to 5/sec. It gets a 5-minute `unstable_cache` window and renders as its own `<Suspense>` component (`TripPanel`), so the conversation never waits on it. **Keep it out of `loadThreadDetail`.**
- **No proactive outbound.** `sendReply` sends whatever `Draft Reply` says on an existing message row, so there is no way to text a guest who has not written first. `replyTo` is null on such a thread and the composer says so. Closing that gap needs a new mercury-server route, not a change here.

## Structure
- `src/app/` — Next.js App Router (`layout.tsx` mounts fonts + globals; `page.tsx` is the trips list; `trip/[tripCode]/page.tsx` is the itinerary; `inbox/**` is the concierge SMS inbox; `api/trips/**` are the JSON endpoints). The three top-level surfaces share one `OpsNav`.
- `src/server/` — server-only data access (`airtable.ts` = client primitives + trips; `itinerary.ts` = booking loaders + day grouping; `concierge.ts` = the guest SMS threads). Anything importing `server-only` must never be imported by a client component.
- `vendor/brand/` — the `mercury-brand` submodule. Treat as read-only from here.
- Path aliases (`tsconfig.json`): `@/*` → `src/*`, `@brand` → the brand tokens.

## Not yet built (expected next)
Per-trip detail (hydrate a trip's reservations — port the per-category booking loaders from the consumer server as needed), auth for ops users, and write paths (Airtable writes go through the Airtable MCP / a server action, never the read token). Build on the `src/server/` boundary; keep the browser token-free.
