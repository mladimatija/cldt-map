# CLDT Map

[![CI](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml/badge.svg)](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.4-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Interactive web map for the **Croatian Long Distance Trail (CLDT)** – a 2,200+ km national hiking trail from Ilok to Prevlaka. Explore the route, view elevation profiles, measure distances, and share your position.

**Live:** [map.cldt.hr](https://map.cldt.hr)

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
- **GPX export** – Download the full trail or any ruler-selected segment as a GPX file
- **Print / export** - Print the current map view as a PDF (landscape, segment auto-fitted) or download as a PNG image
- **Map layers** – Standard, Topo, Satellite, Terrain, CyclOSM, Croatia Topo
- **Weather at trail location** – Current conditions (temperature, feels like, wind, precipitation probability, sunrise/sunset) shown in the location tooltip; 12-hour hourly forecast strip with per-hour temperature, precipitation bars, and wind; automatic "best window" hint identifying the longest dry period; sourced from DHMZ (Croatian Met Service) with Open-Meteo as fallback
- **Trail condition notices** – Regional banner alerts fetched from a JSON feed; dismissible per session
- **Seasonal trail status** – Curated map layer of warnings, closures, and seasonal conditions for the CLDT corridor, sourced from DHMZ (weather warnings), HGSS (mountain rescue), HPS (mountaineering federation), and national parks (Plitvice, Paklenica, Krka, Sjeverni Velebit, Park prirode Velebit). Each active entry is rendered as a severity-colored chip marker placed at the midpoint of its affected km range; hovering or clicking a chip highlights the affected stretch with a halo and opens a centred popout with the severity, recommended gear, source attribution, and a link to the original notice. A non-dismissible banner appears when your GPS is inside a `closed_recommended` or `experts_only` segment. The dataset is refreshed by running `npm run update-seasonal`, which fetches the source pages, summarizes them with the Anthropic API, and rewrites `public/seasonal-status.json`; review the diff and commit to a feature branch.
- **Severe weather alerts** – Meteoalarm CAP warnings for Croatia rendered as color-coded polygons (yellow/orange/red by severity); toggleable map layer; automatic GPS-triggered banner when you enter a warning area; non-dismissible for red/severe warnings; data refreshed every 15 minutes
- **Precipitation radar** – RainViewer radar overlay with animated past + nowcast frames, play/pause controls, and a color-scale legend
- **Location tracking** – Optional GPS to see your position on the trail; optional compass heading cone shows which way you are facing (device orientation, iOS permission-gated)
- **Share links** – Share current map view or progress on the trail
- **Units** – Metric (km) and imperial (miles)
- **Trail style** – Choose how the route polyline is colored from the layers panel: Default (single color), Sections (A/B/C colored zones with boundary markers and per-section stats), or Grade (Strava-style gradient tinting with five bands – warm colors for ascents, cool for descents in the active travel direction; color-ramp legend in the panel; recomputed automatically when the SOBO/NOBO direction toggles); the three options are mutually exclusive
- **Walking pace** – Configurable hiking pace for all ETA estimates; optional grade-adjusted mode applies Naismith + Tobler per-segment integration for more accurate ETAs on climbs and descents
- **Sunset/sunrise markers** – Projects where you will be on the trail at sunset and sunrise based on your current pace and direction; toggleable amber/yellow disc markers on the polyline
- **Multi-day stage planner** - Split any trail range into daily stages by distance (km or miles per day) or fixed stage count; optional ETA-balanced splitting distributes stages by walking time rather than distance; per-stage stats (distance, elevation gain/loss, ETA); active stage highlighted on the map; GPX export per stage; strip-map PDF export (one landscape page per stage with map snapshot and stats header); each stage row shows a POI count badge and an expandable "Places in stage N" sub-list in walking order; an optional trip start date adds a per-stage daily weather chip (condition icon + high temp, with lows and precipitation in the tooltip) for stages within Open-Meteo's 16-day forecast horizon
- **Trip brief export** - One-click printable brief (PDF for printing, DOCX for editing) generated from your stage plan: cover with overview stats and trip-level summary, per-day pages with map snapshot, day narrative, places along the way (name + type + trail km + Wikipedia extract for the popular ones), seasonal-status alerts that intersect the day's km range, and an emergency back page with 112 + HGSS guidance. Localized to en / hr / de / it. AI-generated narratives are reserved for a future release; templated narratives ship today
- **Points of Interest** - Curated dataset of places along or near the trail (towns, settlements, peaks, viewpoints, huts, shelters, food, ATMs, water sources - drinking water taps and springs within 1 km of the route), assembled monthly by a five-pass pipeline: OSM Overpass per type, Croatia boundary filter (point-in-polygon against the bundled MultiPolygon, drops cross-border leaks), Wikidata SPARQL for cities/villages/peaks/huts/viewpoints, Wikimedia Commons MediaWiki API for photo galleries with attribution and license, and Wikipedia REST for short article extracts baked into the dataset. Per-type filter toggles in the layers panel; tag-chip filter in the list panel; popups carry a multi-image photo gallery (tap any thumbnail for a fullscreen lightbox with keyboard navigation and per-image attribution), a Wikipedia summary that opens instantly (baked at enrichment time, no live REST call needed for the popular places), a provenance footer ("Source: Wikidata + OpenStreetMap - verified 2026-05-31"), and a "Copy link to this place" deep-link for sharing. The enricher is failure-resilient: a transient Overpass timeout on one POI type carries forward the prior good rows for that type, and the script refuses to write a fresh dataset that's smaller than 60% of the committed one
- **POI list & search** - Dedicated list panel sortable by trail km, name, distance from trail, or "Near me" (auto-promoted when GPS is locked); optional grouping by 50 km trail decade with sticky headers ("km 0-50 · 8 places"); keyboard navigation with ArrowUp/Down + Enter, S to toggle selection; search popover with diacritic-folding name match ("cakovec" matches "Čakovec"), proximity ranking when GPS is locked, and jump-to-km when you type a number ("100 km" or "60 mi"); per-row selection lets you export hand-picked POIs as a GPX waypoint file for offline use in OSMAnd / Locus / Gaia; the stage planner has its own one-click "POIs as GPX (all stages)" export covering every place along a multi-day plan
- **Offline POI assets** - Pre-cached corridor downloads also fetch POI thumbnails and Wikipedia summaries (via a dedicated `cldt-pois-v1` Cache Storage bucket) so popups stay rich offline; the cache management panel shows how many assets are cached and offers a one-click clear
- **GPX track import** - Drag-and-drop (or file-picker) import of a recorded GPX file; overlays your actual hike as a colored polyline on the trail map; hover any point to see its distance from the official trail; comparison stats panel shows total distance, elapsed time, moving time, average pace, max deviation from the official route, and % of trail covered within 25 m; multiple imports shown in distinct colors; imports persist across sessions (IndexedDB); remove individual tracks from the map and storage; expand a track to see which POIs you passed within 500 m (sorted in walking order with the closest pass distance and cumulative track km)
- **Dark mode & battery saver** – UI preferences and reduced location updates
- **4 languages** – English (en), Croatian (hr), German (de), Italian (it)
- **Offline maps** - Pre-cache the full trail corridor for offline use; per-provider caching, staleness detection, auto-sync on reconnect, predictive corridor pre-cache on Wi-Fi when on-trail, and storage quota handling
- **Emergency 112 panel** - Long-press the red SOS button (bottom-right) for an offline-first emergency panel with current GPS coordinates, Plus Code, trail section/km, bearing and distance to the nearest road access and HGSS mountain rescue station, copy-to-clipboard for each field, and one-tap "Call 112" / "Open in maps" handoff. Works fully offline using bundled datasets (`public/data/road-access.json` from build-time OSM intersections, `public/data/hgss-stations.json` hand-curated)
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
- `NEXT_PUBLIC_DEFAULT_BASE_MAP` - `OpenStreetMap`, `OpenTopoMap`, `Satellite`, `Terrain`, `CyclOSM`, `CroatiaTopo`
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
- `NEXT_PUBLIC_DEFAULT_SEASONAL_STATUS_ENABLED` - show seasonal-status overlay on load. When unset, defaults to on during the winter window (Nov 1–May 31) and off otherwise; setting to `true` or `false` overrides the auto-default
- `NEXT_PUBLIC_DEFAULT_AUTO_SYNC` - auto-sync tile cache in the background by default (default `false`)
- `NEXT_PUBLIC_DEFAULT_PREDICTIVE_PRECACHE` - predictively pre-cache tiles near the user position by default (default `false`)
- `NEXT_PUBLIC_DEFAULT_LOCALE` - `en` or `hr`
- `NEXT_PUBLIC_DEFAULT_MAP_CENTER` - `lat,lng` (e.g. `44.4268,16.438`)
- `NEXT_PUBLIC_DEFAULT_MAP_ZOOM` - initial zoom level
- `NEXT_PUBLIC_TILE_CACHE_TTL_DAYS` - days after which offline tile cache is considered stale (default `30`)
- `NEXT_PUBLIC_NOTICES_URL` - URL for remote trail-condition notices JSON; falls back to bundled `/notices.json` on network error
- `NEXT_PUBLIC_SEASONAL_STATUS_URL` - URL for remote seasonal-status JSON; falls back to bundled `/seasonal-status.json` on network error
- `NEXT_PUBLIC_TRAIL_OSM_TAGS_URL` - URL for remote OSM tag dataset JSON; falls back to bundled `/trail-osm-tags.json` on network error
- `NEXT_PUBLIC_POIS_URL` - URL for remote POI dataset JSON; falls back to bundled `/pois.json` on network error. The bundled file currently runs ~1.5 MB uncompressed (~7,700 rows after Phase 4–5 enrichment) and gzips to ~250 KB; Next.js serves static assets gzipped by default, and `next.config.ts` sets `Cache-Control: public, max-age=86400` on the route so returning visitors do not re-download it. The runtime loader rejects payloads above 20,000 rows with a `console.warn` to surface enricher mistakes that would otherwise silently kill the feature.

Script-only:

- `ANTHROPIC_API_KEY` - required by `npm run update-seasonal` (the curator that synthesises `public/seasonal-status.json` from configured sources). Not read at runtime; set it locally or in CI secrets where the script runs.
- `OSM_OVERPASS_URL` - optional Overpass endpoint override for `npm run enrich-osm` (the OSM tag enricher). Defaults to `https://overpass-api.de/api/interpreter`. Set to a self-hosted instance to bypass public-instance rate limits.

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

---

## Scripts

| Command                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Start development server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run build`                | Build for production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run start`                | Start production server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run lint`                 | Run ESLint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run format`               | Format with Prettier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run format:check`         | Check Prettier formatting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run clean-install`        | Clean reinstall dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run build:emergency-data` | Regenerate `public/data/road-access.json` from the trail GPX intersected with OSM roads (Overpass API). Run when the GPX changes; commit the result. `public/data/hgss-stations.json` is hand-curated separately.                                                                                                                                                                                                                                                                                                            |
| `npm run update-seasonal`      | Refresh `public/seasonal-status.json` from the curated source pages defined in `scripts/seasonal-status-sources.json` (DHMZ, HGSS, HPS, national parks). Requires `ANTHROPIC_API_KEY` in `.env.local`. Resolves Croatian-landmark km positions from the live GPX, summarises each source page with Haiku, synthesises a new JSON file with Sonnet, validates against `public/seasonal-status.schema.json`, and writes the result. Review with `git diff public/seasonal-status.json`, commit on a feature branch, open a PR. |
| `npm run enrich-pois`          | Enrich `public/pois.json` from multiple data sources (Wikidata, HPS hut list, Wikimedia Commons, Wikipedia, OSM reachability filter). Requires `NEXT_PUBLIC_GPX_URL` in `.env.local`; `OSM_OVERPASS_URL` optionally overrides the Overpass endpoint (applies to both `enrich-pois` and `enrich-osm`). Also triggered automatically by the GitHub Action in `.github/workflows/enrich-pois.yml`. Review the diff with `git diff public/pois.json`, commit on a feature branch, open a PR.                                     |

---

## Project Structure

```
src/
├── app/              # Next.js app router
│   ├── [locale]/     # Localized routes (en, hr)
│   │   ├── page.tsx  # Map (home)
│   │   ├── about/    # About page
│   │   └── test/     # Store test page
│   ├── api/          # API routes (e.g. proxy for GPX)
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
│   ├── utils.ts          # Formatting, URL parsing, boundary check, unit conversion
│   ├── weather.ts        # Weather fetch, icon mapping, unit converters
│   └── wikipedia.ts      # Wikipedia REST summary fetch with per-session in-memory cache
├── i18n/             # next-intl routing and request config
├── types/            # TypeScript definitions
└── messages/         # en.json, hr.json, de.json, it.json translations
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
