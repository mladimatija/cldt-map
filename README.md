# CLDT Map

[![CI](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml/badge.svg)](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.9-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Interactive web map for the **Croatian Long Distance Trail (CLDT)** – a 2,200+ km national hiking trail from Ilok to Prevlaka. Explore the route, view elevation profiles, measure distances, and share your position.

**Live:** [map.cldt.hr](https://map.cldt.hr)

> **Note:** The official mobile app of the CLDT is [FarOut](https://faroutguides.com/croatian-long-distance-trail-map/), published in cooperation with the trail association. CLDT Map is an independent project intended for research and educational purposes only - always cross-check critical information (water, hazards, closures) with official sources before relying on it in the field.

---

## Table of Contents

- [User Features](#user-features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Environment](#environment)
  - [Run](#run)
- [Deploy to Netlify](#deploy-to-netlify)
  - [Web push notifications (VAPID)](#web-push-notifications-vapid)
- [Scripts](#scripts)
- [Project Structure](#project-structure)
- [Known Bugs](#known-bugs)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## User Features

- **Interactive trail route** – Click the route or the elevation chart to see distance and elevation at any point
- **Elevation profile** – Chart showing terrain along the route; hover to preview on the map, click to pin a point
- **Distance ruler** – Measure segments; see estimated hiking time (based on configurable walking pace), elevation gain/loss, and section name for the selected range
- **Distance & ETA overlay** – Live HUD chip showing traveled distance, distance remaining, elevation gain/loss remaining, and ETA to trail end (and active ruler section); updates as you move
- **Up next data-book view** - Strip in the distance HUD listing the nearest usable water source, shelter/hut, and town/settlement ahead in your direction of travel, with distance to each; tap a row to fly to it on the map (works regardless of which marker layers are visible; toggleable in Settings)
- **Town resupply guides** - Town and settlement popups list nearby shops and services from OpenStreetMap (grocery, bakery, pharmacy, ATM/bank, post office, bus, fuel) with opening hours where mapped, a "checked, nothing found" state, and the data date with a verify-locally reminder. The stage planner shows a cart chip per stage - gray when a town with groceries lies in the stage, amber when none does ("carry food through") - and the trip brief marks resupply towns in each day's place list. Data refreshes as part of `npm run enrich-pois` (skip with `SKIP_RESUPPLY=1`); a failed query carries the previous data forward
- **Custom waypoints & trip journal** - Long-press (or right-click) anywhere on the map to drop a personal waypoint with a name, note, and category (camp, water, resupply, viewpoint, transport, hazard, or generic); categories color the map pin, round-trip through GPX type/sym on export/import, and can be filtered in the progress panel (list filter + map visibility multiselects). Waypoints snap to the nearest trail km when close to the route, edit in place in their popup (including category chips), and export as GPX. POI popups offer "Add as waypoint" with a suggested category from the POI type. The progress panel adds a dated trip journal - entries can attach the current ruler selection as the day's stretch and export as Markdown. Everything stays on the device
- **Pack weight & water carry** - Optional base weight + water consumption rate in Settings (stored metric, shown and entered in your active unit system - kg/L or lb/qt - and converted automatically when you switch units). Each planner stage then gets a "carry up to X L" chip computed from its longest dry stretch at your pace, the trip brief prints a per-day carry line and a pack row on the cover, and the up-next water row shows the liters needed to reach the next source. An optional toggle slows all ETAs ~1% per kg of base weight above 8 kg. Off by default (leave base weight empty); fully offline. Import a LighterPack or Packstack CSV export to auto-fill the base weight and add a printable gear checklist page to the trip brief, with a best-effort warning when seasonal-status recommended gear (e.g. microspikes) is missing from the list
- **GPX export** – Download the full trail or any ruler-selected segment as a GPX file; on mobile, hand the file straight to OsmAnd / Locus / Gaia via the system share sheet
- **Print / export** - Print the current map view as a PDF (landscape, segment auto-fitted) or download as a PNG image
- **Map layers** – Standard, Topo, Hiking (OpenHikingMap), Satellite, Terrain, CyclOSM, Croatia Topo, Dark; plus an optional Waymarked Trails overlay rendering OSM hiking route relations over any base layer (Settings toggle, online only). OpenHikingMap tiles are excluded from offline pre-caching per the openmaps.fr usage policy
- **Weather at trail location** – Current conditions (temperature, feels like, wind, precipitation probability, sunrise/sunset) shown in the location tooltip; 12-hour hourly forecast strip with per-hour temperature, precipitation bars, and wind; automatic "best window" hint identifying the longest dry period; sourced from DHMZ (Croatian Met Service) with Open-Meteo as fallback
- **Trail condition notices** – Regional banner alerts fetched from a JSON feed; dismissible per session
- **Seasonal trail status** – Curated map layer of warnings, closures, and seasonal conditions for the CLDT corridor, sourced from DHMZ (weather warnings), HGSS (mountain rescue), HPS (mountaineering federation), and national parks (Plitvice, Paklenica, Krka, Sjeverni Velebit, Park prirode Velebit). Each active entry is rendered as a severity-colored chip marker placed at the midpoint of its affected km range; hovering or clicking a chip highlights the affected stretch with a halo and opens a centred popout with the severity, recommended gear, source attribution, and a link to the original notice. A non-dismissible banner appears when your GPS is inside a `closed_recommended` or `experts_only` segment. The dataset is refreshed by running `npm run update-seasonal`, which fetches the source pages, summarizes them with the Anthropic API, and rewrites `public/seasonal-status.json`; review the diff and commit to a feature branch. Optional web-push notifications (Settings toggle, no account) alert you when a new warning is published, even with the app closed.
- **Mine-suspected areas** - Official MUP/HCR mine-suspicion polygons (MSP) near the trail corridor, rendered as red dashed overlays with warning chips at every trail km range that crosses or passes within 500 m of one; clicking opens details with the data date, a disclaimer, and a link to the official misportal.hcr.hr source. A GPS-triggered banner warns when your position is inside a polygon (non-dismissible red) or within the 500 m buffer (dismissible amber) - the banner works even when the layer is toggled off. Layer is ON by default (opt-out safety layer) and fully offline once cached. Dataset is refreshed with `npm run update-mine-areas` from the official SHP download (converted via `ogr2ogr -f GeoJSON msp.geojson MSP.shp`, passed as `MINE_AREAS_FILE`) or any GeoJSON-returning endpoint (`MINE_AREAS_URL`); coordinates in HTRS96/TM (EPSG:3765) are reprojected automatically. Informational only - always obey on-site signage
- **Severe weather alerts** – Meteoalarm CAP warnings for Croatia rendered as color-coded polygons (yellow/orange/red by severity); toggleable map layer; automatic GPS-triggered banner when you enter a warning area; non-dismissible for red/severe warnings; data refreshed every 15 minutes
- **Precipitation radar** – RainViewer radar overlay with animated past + nowcast frames, play/pause controls, and a color-scale legend
- **Location tracking** – Optional GPS to see your position on the trail; optional compass heading cone shows which way you are facing (device orientation, iOS permission-gated)
- **Off-route alert** - Optional warning (Settings toggle, off by default) when you drift more than 200 m from the trail: red banner with your distance from the route and the compass bearing back to it, plus device vibration where supported. Arms itself only after GPS places you on the trail (3 consecutive fixes within 100 m), so it stays silent for users elsewhere in Croatia; auto-disarms after sustained travel beyond 2 km (bus/car ride away); inaccurate fixes (>75 m) are ignored
- **Share links** - Share your current map view or progress on the trail. The share button (control rail) opens a panel with a **QR code** you can scan from another phone, plus **Copy link**. Links carry the full map state (position, direction, units, base map, trail style, layer toggles, ruler range). When short links are enabled (Settings toggle, on by default), the panel resolves a compact `/s/{code}` URL when online (e.g. `https://map.cldt.hr/s/a3Kx9m`) and falls back to the long URL offline or when shortening is unavailable. POI popups still copy share links directly (same shortener). Opening a short link redirects to the stored view; expired or unknown codes fall back to the home map. Shortening needs an internet connection when the panel opens; plain `npm run dev` shows the long URL instead
- **Units** – Metric (km) and imperial (miles)
- **Trail style** – Choose how the route polyline is colored from the layers panel: Default (single color), Sections (A/B/C colored zones with boundary markers and per-section stats), or Grade (Strava-style gradient tinting with five bands – warm colors for ascents, cool for descents in the active travel direction; color-ramp legend in the panel; recomputed automatically when the SOBO/NOBO direction toggles); the three options are mutually exclusive
- **Walking pace** – Configurable hiking pace for all ETA estimates; optional grade-adjusted mode applies Naismith + Tobler per-segment integration for more accurate ETAs on climbs and descents
- **Sunset/sunrise markers** – Projects where you will be on the trail at sunset and sunrise based on your current pace and direction; toggleable amber/yellow disc markers on the polyline
- **Multi-day stage planner** - Split any trail range into daily stages by distance (km or miles per day) or fixed stage count; optional ETA-balanced splitting distributes stages by walking time rather than distance; per-stage stats (distance, elevation gain/loss, ETA); active stage highlighted on the map; GPX export per stage; strip-map PDF export (one landscape page per stage with map snapshot and stats header); each stage row shows a POI count badge and an expandable "Places in stage N" sub-list in walking order; an optional trip start date adds a per-stage daily weather chip (condition icon + high temp, with lows and precipitation in the tooltip) for stages within Open-Meteo's 16-day forecast horizon
- **Trip brief export** - One-click printable brief (PDF for printing, DOCX for editing) generated from your stage plan: cover with overview stats and trip-level summary, per-day pages with map snapshot, elevation profile thumbnail, day narrative, places along the way (name + type + trail km + Wikipedia extract for the popular ones), seasonal-status alerts that intersect the day's km range, and an emergency back page with 112 + HGSS guidance. Localized to en / hr / de / it. Optional AI-written day narratives (guide-style paragraphs generated from the plan's own facts via Claude, online only, plan outline sent to the API); templated narratives remain the default and the automatic fallback
- **Points of Interest** - Curated dataset of places along or near the trail (towns, settlements, peaks, viewpoints, huts, shelters, food, ATMs, water sources - drinking water taps and springs within 1 km of the route), assembled monthly by a five-pass pipeline: OSM Overpass per type, Croatia boundary filter (point-in-polygon against the bundled MultiPolygon, drops cross-border leaks), Wikidata SPARQL for cities/villages/peaks/huts/viewpoints, Wikimedia Commons MediaWiki API for photo galleries with attribution and license, and Wikipedia REST for short article extracts baked into the dataset. Per-type filter toggles in the layers panel; tag-chip filter in the list panel; optional include-remote-POIs toggle in the list panel (walking-unreachable with no nearby trail-side bus/train stop - off by default; Pass 6 reachability also rescues some places via public transport escape signals). Popups carry a multi-image photo gallery (tap any thumbnail for a fullscreen lightbox with keyboard navigation and per-image attribution), a Wikipedia summary that opens instantly (baked at enrichment time, no live REST call needed for the popular places), a star in the title row for the active favourites list, a provenance footer ("Source: Wikidata + OpenStreetMap - verified 2026-05-31"), and a "Copy link to this place" deep-link for sharing. The enricher is failure-resilient: a transient Overpass timeout on one POI type carries forward the prior good rows for that type, and the script refuses to write a fresh dataset that's smaller than 60% of the committed one
- **POI list & search** - Dedicated list panel sortable by trail km, name, distance from trail, or "Near me" (auto-promoted when GPS is locked); optional grouping by 50 km trail decade with sticky headers ("km 0-50 · 8 places"); keyboard navigation with ArrowUp/Down + Enter, S to toggle selection; search popover with diacritic-folding name match ("cakovec" matches "Čakovec"), proximity ranking when GPS is locked, and jump-to-km when you type a number ("100 km" or "60 mi"); save current type+tag filters as named presets (apply, rename, delete); star places from the list or popup into multiple named lists with an active-list switcher (trip brief "selected only" and share URLs use the active list; opening a share link replaces all lists with the imported stars); per-row selection lets you export hand-picked POIs as a GPX waypoint file for offline use in OSMAnd / Locus / Gaia; the stage planner has its own one-click "POIs as GPX (all stages)" export covering every place along a multi-day plan
- **Water source intelligence** - Every water POI carries a reliability class derived from OSM ground-truth tags: Reliable (built drinking-water tap, or a spring explicitly confirmed potable), Seasonal (seasonal/intermittent flow - may be dry), Unverified (untagged spring - treat before drinking), or Not drinkable. The class colors the map marker (blue / amber / slate / red) and shows as a badge in the POI popup (with the mapper's last check date when recorded) and in list rows. The multi-day stage planner computes each stage's longest stretch without a usable source and flags it with an amber chip past 15 km and a red one past 25 km. Unnamed taps and springs are kept with generic names (most OSM water is unnamed), so coverage reflects the corridor's real water; the pipeline supports partial refreshes via `POI_TYPES=water npm run enrich-pois`
- **Offline POI assets** - Pre-cached corridor downloads also fetch POI thumbnails and Wikipedia summaries (via a dedicated `cldt-pois-v1` Cache Storage bucket) so popups stay rich offline; the cache management panel shows how many assets are cached and offers a one-click clear
- **GPX track import** - Drag-and-drop (or file-picker) import of recorded GPX files, multiple at once; overlays your actual hike as a colored polyline on the trail map; hover any point to see its distance from the official trail; comparison stats panel shows total distance, elapsed time, moving time, average pace, max deviation from the official route, and the share of the track that runs within 25 m of the official route; multiple imports shown in distinct colors; imports persist across sessions (IndexedDB); remove individual tracks from the map and storage; expand a track to see which POIs you passed within 500 m (sorted in walking order with the closest pass distance and cumulative track km). Files up to 50 MB are accepted; points are simplified on import (5 m Douglas-Peucker) and tracks render through a shared canvas renderer, so multi-day recordings stay fast. Each track has a color picker and a show/hide eye toggle - hidden tracks keep their data and stats without rendering cost
- **Section completion tracking** - Track which parts of the trail you have hiked. Progress is stored as km intervals (persisted locally) and can be marked three ways: automatically from GPS while hiking on-trail (consecutive accurate fixes within 150 m of the route; teleports and bad fixes never count), manually from the current ruler selection or whole A/B/C sections, or by importing an uploaded GPX track's on-trail coverage with one click. Completed stretches draw as a green overlay on top of any trail style; the progress panel (checkmark button) shows total km / % done with a per-section breakdown, plus toggles for auto-record and the overlay and a confirm-guarded clear; a "Hiked" line with your personal total also appears in the location tooltip and the distance HUD once progress exists
- **In-app help** - A ? button in the control rail opens a topic-grouped reference (map basics, elevation chart interactions, hidden gestures like the SOS long-press and GPX drag-and-drop, planning tools, offline behaviour); the share button opens a QR panel for handoff to another device; the SOS button additionally hints "hold to open" when short-tapped, and the imports panel advertises drag-and-drop in its empty state
- **Dark mode & battery saver** – UI preferences and reduced location updates; optional keep-screen-on while tracking (screen wake lock, battery saver wins)
- **4 languages** – English (en), Croatian (hr), German (de), Italian (it)
- **Offline maps** - Pre-cache the full trail corridor for offline use; per-provider caching, staleness detection, auto-sync on reconnect, predictive corridor pre-cache on Wi-Fi when on-trail, and storage quota handling
- **Emergency 112 panel** - Long-press the red SOS button (bottom-right) for an offline-first emergency panel with current GPS coordinates, Plus Code, trail section/km, bearing and distance to the nearest road access and HGSS mountain rescue station, copy-to-clipboard for each field, and one-tap "Call 112" / "Open in maps" handoff. When online, an address line is looked up via the server (Nominatim proxy) and can be copied; offline or on lookup failure the panel still works from bundled datasets (`public/data/road-access.json` from build-time OSM intersections, `public/data/hgss-stations.json` hand-curated)
- **Privacy-first** - Location stays in your browser; no account required

---

## Tech Stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Framework | Next.js 16, React 19                                    |
| Language  | TypeScript                                              |
| Maps      | Leaflet, react-leaflet                                  |
| State     | Zustand (slices + persisted)                            |
| Styling   | Tailwind CSS                                            |
| i18n      | next-intl                                               |
| Charts    | Recharts                                                |
| Data      | localforage (GPX + tile cache + imported tracks), fetch |

---

## Getting Started

### Prerequisites

- Node.js 24+
- npm, yarn, or pnpm

### Install

```bash
git clone https://github.com/mladimatija/cldt-map.git
cd cldt-map
npm install
```

### Environment

Copy `.env.example` to `.env.local` and set the GPX URL:

```bash
cp .env.example .env.local
```

Required:

- `NEXT_PUBLIC_GPX_URL` - URL to the trail GPX file

Optional overrides (see `src/lib/config.ts`, `src/lib/gpx-cache.ts`):

- `NEXT_PUBLIC_CACHE_VERSION` - Bump to invalidate GPX cache (default `1`)
- `NEXT_PUBLIC_CORS_PROXY` - Override GPX proxy base (default `/api/proxy?url=`)
- `NEXT_PUBLIC_DEFAULT_DIRECTION` - `SOBO` or `NOBO`
- `NEXT_PUBLIC_DEFAULT_UNITS` - `metric` or `imperial`
- `NEXT_PUBLIC_DEFAULT_DISTANCE_PRECISION` - decimal places
- `NEXT_PUBLIC_SHOW_BOUNDARY` - show Croatia boundary on load
- `NEXT_PUBLIC_SHOW_TILE_BOUNDARY` - boundary-clipped tiles
- `NEXT_PUBLIC_SHOW_USER_MARKER` - show user location by default
- `NEXT_PUBLIC_DEFAULT_BASE_MAP` - `OpenStreetMap`, `OpenTopoMap`, `OpenHikingMap`, `Satellite`, `Terrain`, `CyclOSM`, `CroatiaTopo`
- `NEXT_PUBLIC_DEFAULT_DARK_MODE` - dark mode on load
- `NEXT_PUBLIC_DEFAULT_BATTERY_SAVER` - battery saver on load
- `NEXT_PUBLIC_DEFAULT_LARGE_TOUCH_TARGETS` - large touch targets on load (accessibility)
- `NEXT_PUBLIC_DEFAULT_RULER_ENABLED` - distance ruler on load
- `NEXT_PUBLIC_DEFAULT_SHOW_SECTIONS` - show trail sections on load (default `false`)
- `NEXT_PUBLIC_DEFAULT_GRADE_TINTED_TRAIL` - render grade-tinted trail on load (default `false`; mutually exclusive with show-sections / surface-colored / sac-colored)
- `NEXT_PUBLIC_DEFAULT_SURFACE_COLOURED` - color trail polyline by OSM surface type on load (default `false`; requires `public/trail-osm-tags.json` populated via `npm run enrich-osm`)
- `NEXT_PUBLIC_DEFAULT_SAC_COLOURED` - color trail polyline by SAC hiking-difficulty scale on load (default `false`; requires the same OSM tag dataset)
- `NEXT_PUBLIC_DEFAULT_DISTANCE_MARKERS` - show zoom-aware distance markers along the trail (default `false`). Levels 100/50/25/10/5/1 reveal progressively as you zoom in; labeled in km or mi depending on `NEXT_PUBLIC_DEFAULT_UNITS`
- `NEXT_PUBLIC_DEFAULT_POIS_ENABLED` - show the POI map layer on load (default `true`)
- `NEXT_PUBLIC_DEFAULT_POI_TYPES` - comma-separated list of POI types enabled by default. Default `town,settlement,peak,viewpoint,hut,shelter,restaurant,cafe,food,atm`. Unknown types are silently ignored, so the same env value keeps working as new types are added
- `NEXT_PUBLIC_DEFAULT_WALKING_PACE_KMH` - walking pace in km/h used for passage-time estimates (default `4`)
- `NEXT_PUBLIC_DEFAULT_GRADE_ADJUSTED_ETA` - apply Tobler-style grade adjustment to ETA (default `true`)
- `NEXT_PUBLIC_DEFAULT_SUNSET_PROJECTION` - show sunset projection along the trail on load (default `false`)
- `NEXT_PUBLIC_DEFAULT_SEVERE_WEATHER_LAYER` - show severe-weather overlay on load (default `false`)
- `NEXT_PUBLIC_DEFAULT_SHARE_SHORT_LINKS` - copy compact `/s/{code}` share links by default (default `true`). Set to `false` to always copy the full query-string URL. The Settings panel toggle overrides this per user once changed. Shortening is server-side only (see [Share link shortener](#share-link-shortener) under Deploy to Netlify); local `npm run dev` always falls back to the long URL
- `NEXT_PUBLIC_DEFAULT_SEASONAL_STATUS_ENABLED` - show seasonal-status overlay on load. When unset, defaults to on during the winter window (Nov 1–May 31) and off otherwise; setting to `true` or `false` overrides the auto-default
- `NEXT_PUBLIC_DEFAULT_AUTO_SYNC` - auto-sync tile cache in the background by default (default `false`)
- `NEXT_PUBLIC_DEFAULT_PREDICTIVE_PRECACHE` - predictively pre-cache tiles near the user position by default (default `false`)
- `NEXT_PUBLIC_DEFAULT_LOCALE` - `en` or `hr`
- `NEXT_PUBLIC_DEFAULT_MAP_CENTER` - `lat,lng` (e.g. `44.4268,16.438`)
- `NEXT_PUBLIC_DEFAULT_MAP_ZOOM` - initial zoom level
- `NEXT_PUBLIC_TILE_CACHE_TTL_DAYS` - days after which offline tile cache is considered stale (default `30`)
- `NEXT_PUBLIC_NOTICES_URL` - URL for remote trail-condition notices JSON; falls back to bundled `/notices.json` on network error
- `NEXT_PUBLIC_SEASONAL_STATUS_URL` - URL for remote seasonal trail status JSON; falls back to bundled `/seasonal-status.json` on network error
- `NEXT_PUBLIC_TRAIL_OSM_TAGS_URL` - URL for remote OSM tag dataset JSON; falls back to bundled `/trail-osm-tags.json` on network error
- `NEXT_PUBLIC_POIS_URL` - URL for remote POI dataset JSON; falls back to bundled `/pois.json` on network error. The bundled file currently runs ~1.5 MB uncompressed (~7,700 rows after Phase 4–5 enrichment) and gzips to ~250 KB; Next.js serves static assets gzipped by default, and `next.config.ts` sets `Cache-Control: public, max-age=86400` on the route so returning visitors do not re-download it. The runtime loader rejects payloads above 20,000 rows with a `console.warn` to surface enricher mistakes that would otherwise silently kill the feature.

Script-only:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` - optional deploy-only web push for new seasonal warnings and trail condition notices (see [Web push notifications (VAPID)](#web-push-notifications-vapid)). Users opt in via Settings; without all three vars the toggle stays hidden and in-app banners still work
- `ANTHROPIC_API_KEY` - required by `npm run update-seasonal` (the curator that synthesises `public/seasonal-status.json` from configured sources), and, when set in the deploy environment, enables the `/api/narrative` route that writes AI day narratives for trip briefs (optional; the brief falls back to templated text when unset). `NARRATIVE_MODEL` optionally overrides the model.
- `OSM_OVERPASS_URL` - optional Overpass endpoint override for `npm run enrich-osm` and `npm run enrich-pois`. Defaults to `https://overpass-api.de/api/interpreter`. Set to a self-hosted instance to bypass public-instance rate limits.
- `OSM_OVERPASS_FALLBACK_URLS` - comma-separated Overpass mirrors that `npm run enrich-pois` fails over to after the primary endpoint exhausts its retry budget. Defaults to `https://overpass.kumi.systems/api/interpreter`; set to an empty string to disable failover.
- `ENRICH_POIS_CACHE_TTL_HOURS` / `ENRICH_POIS_NO_CACHE` - `npm run enrich-pois` caches successful per-type Overpass results in `.cache/enrich-pois` (default TTL 24 h) so a rerun after a partial failure only refetches the failed types; set `ENRICH_POIS_NO_CACHE=1` to force fresh fetches.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Netlify

1. **Push to GitHub** and import the repo in [Netlify](https://netlify.com).

2. **Set environment variables** in Site settings → Environment variables:

   | Variable                    | Required | Example                               |
   | --------------------------- | -------- | ------------------------------------- |
   | `NEXT_PUBLIC_GPX_URL`       | Yes      | `https://cldt.hr/.../trail.gpx`       |
   | `NEXT_PUBLIC_CACHE_VERSION` | No       | `1` (bump to invalidate cache)        |
   | Other `NEXT_PUBLIC_*`       | No       | See [Environment](#environment) above |

3. **Deploy** - Netlify runs the build, and the Essential Next.js plugin handles the output. Node.js 24 is set in `netlify.toml`.

**If you see "Page not found" or "publish directory cannot be the same as base directory":** In Site settings → Build & deploy → Build settings, clear **Base directory** and **Publish directory** (leave both empty) so `netlify.toml` applies. The config sets `publish = ".next"`.

### Share link shortener

Map and POI share links can be shortened to `/s/{code}` so they fit SMS and chat apps. The long URL (all query params) is stored in **Netlify Blobs** (`share-links` store); no extra env vars are required beyond a normal Netlify deploy.

| Route / function                            | Role                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/share`                           | Validate a same-origin share URL, allocate a 7-character code, store the target path + query in Blobs (90-day TTL). Rate limited to 30 creates per IP per hour. |
| `GET /s/{code}`                             | Look up the code and `302` redirect to the stored target. Increments a hit counter. Expired or missing codes redirect to `/`.                                   |
| `netlify/functions/share-links-cleanup.mts` | Scheduled monthly job that deletes expired entries from the Blobs store (redirects also reject expired links lazily).                                           |

**Client behaviour:** When "Use short share links" is on (Settings, default from `NEXT_PUBLIC_DEFAULT_SHARE_SHORT_LINKS`), the share panel and POI copy actions call `POST /api/share` first and fall back to the long URL if the API is unavailable (offline, rate limit, or Blobs not configured). Successful short links are cached for the browser tab keyed by the long URL, so reopening the share panel or copying again for the same view does not mint another code. The share panel renders that URL as a QR code (`react-qr-code`, lazy-loaded) for scanning from another phone.

**Local development:** `npm run dev` does not configure Netlify Blobs, so shortening returns `503` and the client copies the long URL. Use [`netlify dev`](https://docs.netlify.com/api-and-deploy-docs/cli/local-development/) to exercise the shortener against a local Blobs store.

**Netlify-built-in deploy URLs (`URL`, `DEPLOY_URL`, `DEPLOY_PRIME_URL`):** The share API validates submitted URLs against an allowlist of hostnames. Besides the incoming `Host` / `X-Forwarded-Host` headers, it also reads three [read-only Netlify variables](https://docs.netlify.com/build/configure-builds/environment-variables/#deploy-urls-and-metadata). You do **not** add these in Site settings or `.env.local`; Netlify sets them per deploy.

| Variable           | Set by Netlify                                         | Typical value by context                                                                                                                                    |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `URL`              | Always (build; also available to Functions at runtime) | Production site URL (`https://map.cldt.hr` or your Netlify subdomain)                                                                                       |
| `DEPLOY_PRIME_URL` | Build (and `netlify dev`)                              | **Production:** same as `URL`. **Deploy Preview:** `https://deploy-preview-N--site.netlify.app`. **Branch deploy:** `https://branch-name--site.netlify.app` |
| `DEPLOY_URL`       | Build (and `netlify dev`)                              | Unique URL for this deploy: `https://{deploy-id}--site.netlify.app` (all contexts)                                                                          |

On Netlify, no manual configuration is required for `map.cldt.hr` - the allowlist always includes `siteMetadata.url` (the canonical production domain), so shortening works even when Netlify's `URL` still points at `*.netlify.app` and request headers omit the custom host. At API runtime, `URL` is the reliable built-in; `DEPLOY_*` may be unset in serverless Functions (they are always present at build time). Request headers cover deploy-preview and branch hosts in practice.

Optional: set `SHARE_EXTRA_ALLOWED_HOSTS` in Netlify Site settings (comma-separated hostnames) if you serve the app on additional aliases (e.g. `www.map.cldt.hr`).

Locally, plain `npm run dev` leaves all three unset; localhost is still allowed via request headers. To mirror Netlify values locally, run [`netlify dev`](https://docs.netlify.com/api-and-deploy-docs/cli/local-development/) (CLI injects the same read-only vars). Do not copy production URLs into `.env.local` unless you are debugging a specific host-matching edge case.

**Security:** Only same-origin URLs whose query string contains recognised share params are accepted (no open redirects). Codes are random, not sequential.

### Web push notifications (VAPID)

Optional **browser push** when a new seasonal warning or trail condition notice is published, even with the app closed. End users opt in via the **Notify about trail alerts** toggle in Settings (no account). **VAPID keys are deployer/server infrastructure** - they identify your app to browser push services and are never shown to users.

The map works fully without them: seasonal-status and trail-notice **in-app banners still work**, and the Settings toggle is hidden when keys are not configured.

Generate a key pair:

```bash
npx web-push generate-vapid-keys
```

Set all three variables in the Netlify deploy environment (Production scope):

| Variable                       | Required | Secret? | Role                                                                                                                               |
| ------------------------------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Yes      | No      | Public half of the VAPID key pair; baked into the client bundle at build time so the browser can subscribe                         |
| `VAPID_PRIVATE_KEY`            | Yes      | Yes     | Private half; used only by Netlify Functions to sign outgoing push messages. Never commit                                          |
| `VAPID_SUBJECT`                | Yes      | No      | Contact URI for push services (typically `mailto:you@example.com` or an `https://` site URL). Not shown to users; not a secret key |

**Netlify:** Site configuration → Environment variables → **Production** (and Deploy Previews if you want push there). After adding or changing `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, trigger a **new deploy** so the public key is rebuilt into the app.

**Local testing:** Copy the three vars into `.env.local`, then run [`netlify dev`](https://docs.netlify.com/api-and-deploy-docs/cli/local-development/) (not plain `npm run dev`) so Functions, Blobs, and the baked-in public key match production. Plain `npm run dev` leaves push disabled.

| Route / function                            | Role                                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /.netlify/functions/push-subscribe`   | Store or remove a browser push subscription in Netlify Blobs (`push-subscriptions`). Returns `503` when VAPID is not configured.                                                                                                                |
| `netlify/functions/push-seasonal-check.mts` | Scheduled **hourly**: same pattern for seasonal trail warnings (`NEXT_PUBLIC_SEASONAL_STATUS_URL` with bundled `/seasonal-status.json` fallback), using a `seen-seasonal-ids` baseline (first run records baseline only, no blast notification) |
| `netlify/functions/push-notices-check.mts`  | Scheduled **hourly**: same pattern for active trail condition notices (`NEXT_PUBLIC_NOTICES_URL` with bundled `/notices.json` fallback), using a `seen-notice-ids` baseline                                                                     |

Dead subscriptions (HTTP 404/410 from the push service) are pruned automatically on send.

---

## Scripts

| Command                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                  | Start development server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run build`                | Build for production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run start`                | Start production server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run lint`                 | Run ESLint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run format`               | Format with Prettier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run format:check`         | Check Prettier formatting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run clean-install`        | Clean reinstall dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run build:emergency-data` | Regenerate `public/data/road-access.json` from the trail GPX intersected with OSM roads (Overpass API). Run when the GPX changes; commit the result. `public/data/hgss-stations.json` is hand-curated separately.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run update-seasonal`      | Refresh `public/seasonal-status.json` from the curated source pages defined in `scripts/seasonal-status-sources.json` (DHMZ, HGSS, HPS, national parks). Requires `ANTHROPIC_API_KEY` in `.env.local`. Resolves Croatian-landmark km positions from the live GPX, summarises each source page with Haiku, synthesises a new JSON file with Sonnet, validates against `public/seasonal-status.schema.json`, and writes the result. Review with `git diff public/seasonal-status.json`, commit on a feature branch, and deploy (or point `NEXT_PUBLIC_SEASONAL_STATUS_URL` at the hosted file) so in-app users and seasonal web push stay aligned. |
| `npm run enrich-pois`          | Enrich `public/pois.json` from multiple data sources (Wikidata, HPS hut list, Wikimedia Commons, Wikipedia, OSM reachability filter). Requires `NEXT_PUBLIC_GPX_URL` in `.env.local`; `OSM_OVERPASS_URL` optionally overrides the Overpass endpoint (applies to both `enrich-pois` and `enrich-osm`), with automatic failover to `OSM_OVERPASS_FALLBACK_URLS` and a 24 h per-type result cache in `.cache/enrich-pois` so reruns only refetch failed types. Also triggered automatically by the GitHub Action in `.github/workflows/enrich-pois.yml`. Review the diff with `git diff public/pois.json`, commit on a feature branch, open a PR.   |

---

## Project Structure

```
src/
├── app/              # Next.js app router
│   ├── [locale]/     # Localized routes (en, hr)
│   │   ├── page.tsx  # Map (home)
│   │   ├── about/    # About page
│   │   └── test/     # Store test page
│   ├── api/          # API routes (GPX proxy, share shortener, weather, narrative)
│   ├── s/[code]/     # Short share link redirects (/s/{code} → stored map URL)
│   └── styles/       # CSS (base, theme, map, components)
├── components/
│   ├── map/          # Map, BaseMapSelector, TrailRoute, MapMarkers, controls
│   ├── layout/       # Header, Footer, Layout
│   ├── ui/           # Button, Card, Tooltip, etc.
│   ├── common/       # ErrorBoundary, ServiceWorkerProvider, ThemeProvider
│   ├── charts/       # ElevationChart
│   └── providers/    # ClientIntlProvider
├── hooks/            # useMapService, useBlockMapPropagation, useSiteMetadata, usePanelManager, usePoisFetch, usePoiListRows
├── lib/
│   ├── store/            # Zustand slices, map-store, stub, types
│   ├── services/         # LocationService, MapService, base-map-provider
│   ├── config.ts         # App defaults (env overrides)
│   ├── date-format.ts    # ISO date and "generated at" formatting helpers shared by exports
│   ├── distance-utils.ts # ETA, grade-adjusted pace, nearest-point search, ruler formatting
│   ├── export-utils.ts   # PNG/PDF export: CORS detection, bounds fitting, strip-map PDF generation
│   ├── gpx-cache.ts      # GPX fetch + localforage cache
│   ├── gpx-export.ts     # GPX XML builder and segment extractor for file downloads
│   ├── gpx-parser.ts     # Shared GPX XML parser; returns all tracks with timestamps and elevation
│   ├── imported-tracks.ts # Imported track storage (localforage), deduplication, and comparison stats
│   ├── map-events.ts     # Custom DOM event helpers (ruler-from-chart bridge)
│   ├── map.ts            # Trail metadata calculation (distance, elevation)
│   ├── metadata.ts       # Site metadata and Open Graph config
│   ├── notices.ts        # Trail condition notice loader and types
│   ├── poi-prefetch.ts   # Cache Storage prefetch of POI thumbnails + Wikipedia summaries; corridor-slice POI selection (used by predictive precache via the store)
│   ├── poi-proximity.ts  # POI-to-track proximity helpers (haversine, nearest-pass detection)
│   ├── poi-types.ts      # Shared POI domain types and type-group definitions
│   ├── pois.ts           # POI dataset loader (with size cap), name-search, tag/type predicates, display-name helpers
│   ├── ruler-from-chart.ts # Custom event types for chart→ruler integration
│   ├── stage-planner.ts  # Stage splitting (by distance / ETA) and per-stage stats
│   ├── tile-cache.ts     # Tile pre-caching, corridor generation, metadata, storage utils (POI prefetch is orchestrated by the store, not by this module)
│   ├── trail-sections.ts # Trail section colour and label definitions
│   ├── trip-brief.ts     # Trip-brief assembly from a stage plan (overview, per-day, POI selection, alerts)
│   ├── trip-brief-i18n.ts # Shared localisation table for PDF + DOCX trip-brief generators
│   ├── trip-brief-pdf.ts # PDF trip-brief generator (jspdf, lazy-imported)
│   ├── trip-brief-docx.ts # DOCX trip-brief generator (docx, lazy-imported)
│   ├── types.ts          # Shared TypeScript types (UnitSystem, etc.)
│   ├── share-url-constants.ts   # Share query param keys (encode, parse, shortener validation)
│   ├── share-shortener-server.ts # Blobs storage, validation, TTL (server-only)
│   ├── share-shortener-client.ts # Client fetch with long-URL fallback
│   ├── weather.ts        # Weather fetch, icon mapping, unit converters
│   ├── wikipedia.ts      # Wikipedia REST summary fetch with per-session in-memory cache
│   └── utils.ts          # Formatting, URL parsing, boundary check, unit conversion, share URL builders
├── i18n/             # next-intl routing and request config
├── types/            # TypeScript definitions
└── messages/         # en.json, hr.json, de.json, it.json translations
netlify/functions/    # Scheduled jobs (seasonal/notices push, share-link cleanup) + push-subscribe
```

---

## Known Bugs

_None currently tracked._

---

## License

MIT - see [LICENSE](LICENSE).

---

## Acknowledgments

- Trail data: [Udruga Long Distance Trail Hrvatska (LDTH)](https://cldt.hr)
- Map tiles: OpenStreetMap, OpenTopoMap, CyclOSM, Esri, DGU
- Weather data: [DHMZ (Croatian Met Service)](https://meteo.hr), [Open-Meteo](https://open-meteo.com)
- Radar tiles: [RainViewer](https://www.rainviewer.com)
- Seasonal trail status & hazard warnings: [HGSS (Croatian Mountain Rescue)](https://www.hgss.hr), [HPS (Croatian Mountaineering Federation)](https://www.hps.hr), [NP Plitvička jezera](https://np-plitvicka-jezera.hr), [NP Sjeverni Velebit](https://np-sjeverni-velebit.hr), [NP Paklenica](https://np-paklenica.hr), [NP Krka](https://www.np-krka.hr), [Park prirode Velebit](https://pp-velebit.hr)
- Mountain rescue station data: [HGSS](https://www.hgss.hr)
