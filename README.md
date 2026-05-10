# CLDT Map

[![CI](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml/badge.svg)](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.4-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Interactive web map for the **Croatian Long Distance Trail (CLDT)** - a 2,200+ km national hiking trail from Ilok to Prevlaka. Explore the route, view elevation profiles, measure distances, and share your position.

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

- **Interactive trail route** - Click the route or the elevation chart to see distance and elevation at any point
- **Elevation profile** - Chart showing terrain along the route; hover to preview on the map, click to pin a point
- **Distance ruler** - Measure segments; see estimated hiking time (based on configurable walking pace), elevation gain/loss, and section name for the selected range
- **Distance & ETA overlay** - Live HUD chip showing traveled distance, distance remaining, elevation gain/loss remaining, and ETA to trail end (and active ruler section); updates as you move
- **GPX export** - Download the full trail or any ruler-selected segment as a GPX file
- **Print / export** - Print the current map view as a PDF (landscape, segment auto-fitted) or download as a PNG image
- **Map layers** - Standard, Topo, Satellite, Terrain, CyclOSM, Croatia Topo
- **Weather at trail location** - Current conditions (temperature, feels like, wind, precipitation probability, sunrise/sunset) shown in the location tooltip; 12-hour hourly forecast strip with per-hour temperature, precipitation bars, and wind; automatic "best window" hint identifying the longest dry period; sourced from DHMZ (Croatian Met Service) with Open-Meteo as fallback
- **Trail condition notices** - Regional banner alerts fetched from a JSON feed; dismissible per session
- **Severe weather alerts** - Meteoalarm CAP warnings for Croatia rendered as colour-coded polygons (yellow/orange/red by severity); toggleable map layer; automatic GPS-triggered banner when you enter a warning area; non-dismissible for red/severe warnings; data refreshed every 15 minutes
- **Precipitation radar** - RainViewer radar overlay with animated past + nowcast frames, play/pause controls, and a colour-scale legend
- **Location tracking** - Optional GPS to see your position on the trail
- **Share links** - Share current map view or progress on the trail
- **Units** - Metric (km) and imperial (miles)
- **Trail sections** - Optional color-coded sections (A/B/C) with boundary markers and stats (persisted)
- **Walking pace** - Configurable hiking pace for all ETA estimates; optional grade-adjusted mode applies Naismith + Tobler per-segment integration for more accurate ETAs on climbs and descents
- **Sunset/sunrise markers** - Projects where you will be on the trail at sunset and sunrise based on your current pace and direction; toggleable amber/yellow disc markers on the polyline
- **Multi-day stage planner** - Split any trail range into daily stages by distance (km or miles per day) or fixed stage count; optional ETA-balanced splitting distributes stages by walking time rather than distance; per-stage stats (distance, elevation gain/loss, ETA); active stage highlighted on the map; GPX export per stage; strip-map PDF export (one landscape page per stage with map snapshot and stats header)
- **GPX track import** - Drag-and-drop (or file-picker) import of a recorded GPX file; overlays your actual hike as a coloured polyline on the trail map; hover any point to see its distance from the official trail; comparison stats panel shows total distance, elapsed time, moving time, average pace, max deviation from the official route, and % of trail covered within 25 m; multiple imports shown in distinct colours; imports persist across sessions (IndexedDB); remove individual tracks from the map and storage
- **Dark mode & battery saver** - UI preferences and reduced location updates
- **4 languages** - English (en), Croatian (hr), German (de), Italian (it)
- **Offline maps** - Pre-cache the full trail corridor for offline use; per-provider caching, staleness detection, auto-sync on reconnect, predictive corridor pre-cache on Wi-Fi when on-trail, and storage quota handling
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
- `NEXT_PUBLIC_DEFAULT_LOCALE` - `en` or `hr`
- `NEXT_PUBLIC_DEFAULT_MAP_CENTER` - `lat,lng` (e.g. `44.4268,16.438`)
- `NEXT_PUBLIC_DEFAULT_MAP_ZOOM` - initial zoom level
- `NEXT_PUBLIC_TILE_CACHE_TTL_DAYS` - days after which offline tile cache is considered stale (default `30`)

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

3. **Deploy** - Netlify runs the build and the Essential Next.js plugin handles the output. Node.js 24 is set in `netlify.toml`.

**If you see "Page not found" or "publish directory cannot be the same as base directory":** In Site settings → Build & deploy → Build settings, clear **Base directory** and **Publish directory** (leave both empty) so `netlify.toml` applies. The config sets `publish = ".next"`.

---

## Scripts

| Command                 | Description                  |
| ----------------------- | ---------------------------- |
| `npm run dev`           | Start development server     |
| `npm run build`         | Build for production         |
| `npm run start`         | Start production server      |
| `npm run lint`          | Run ESLint                   |
| `npm run format`        | Format with Prettier         |
| `npm run format:check`  | Check Prettier formatting    |
| `npm run clean-install` | Clean reinstall dependencies |

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
├── hooks/            # useMapService, useBlockMapPropagation, useSiteMetadata
├── lib/
│   ├── store/            # Zustand slices, map-store, stub, types
│   ├── services/         # LocationService, MapService, base-map-provider
│   ├── config.ts         # App defaults (env overrides)
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
│   ├── ruler-from-chart.ts # Custom event types for chart→ruler integration
│   ├── stage-planner.ts  # Stage splitting (by distance / ETA) and per-stage stats
│   ├── tile-cache.ts     # Tile pre-caching, corridor generation, metadata, storage utils
│   ├── trail-sections.ts # Trail section colour and label definitions
│   ├── types.ts          # Shared TypeScript types (UnitSystem, etc.)
│   ├── utils.ts          # Formatting, URL parsing, boundary check, unit conversion
│   └── weather.ts        # Weather fetch, icon mapping, unit converters
├── i18n/             # next-intl routing and request config
├── types/            # TypeScript definitions
└── messages/         # en.json, hr.json, de.json, it.json translations
```

---

## Known Bugs

- **Stage planner GPX export ignores trail direction**: Exported GPX segments always contain track points in SOBO order regardless of the currently active trail direction. NOBO users will need to reverse the track in their GPS app or software.

---

## License

MIT - see [LICENSE](LICENSE).

---

## Acknowledgments

- Trail data: [Udruga Long Distance Trail Hrvatska (LDTH)](https://cldt.hr)
- Map tiles: OpenStreetMap, OpenTopoMap, CyclOSM, Esri, DGU
- Weather data: [DHMZ (Croatian Met Service)](https://meteo.hr), [Open-Meteo](https://open-meteo.com)
- Radar tiles: [RainViewer](https://www.rainviewer.com)
