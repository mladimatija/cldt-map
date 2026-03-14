# CLDT Map

[![CI](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml/badge.svg)](https://github.com/mladimatija/cldt-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Interactive web map for the **Croatian Long Distance Trail (CLDT)** - a 2,200+ km national hiking trail from Ilok to Prevlaka. Explore the route, view elevation profiles, measure distances, and share your position.

**Live:** [map.cldt.hr](https://map.cldt.hr)

---

## User Features

- **Interactive trail route** - Click the route or the elevation chart to see distance and elevation at any point
- **Elevation profile** - Chart showing terrain along the route; hover to preview on the map, click to pin a point
- **Distance ruler** - Measure segments between two points
- **Map layers** - Standard, Topo, Satellite, Terrain, CyclOSM, Croatia Topo
- **Location tracking** - Optional GPS to see your position on the trail
- **Share links** - Share current map view or progress on the trail
- **Units** - Metric (km) and imperial (miles)
- **Trail sections** - Optional color-coded sections (A/B/C) with boundary markers and stats (persisted)
- **Dark mode & battery saver** - UI preferences and reduced location updates
- **Bilingual** - English and Croatian (hr)
- **Offline maps** - Pre-cache the full trail corridor for offline use; per-provider caching, staleness detection, auto-sync on reconnect, and storage quota handling
- **Privacy-first** - Location stays in your browser; no account required

---

## Tech Stack

| Layer     | Technology                     |
| --------- | ------------------------------ |
| Framework | Next.js 16, React 19           |
| Language  | TypeScript                     |
| Maps      | Leaflet, react-leaflet         |
| State     | Zustand (slices + persisted)   |
| Styling   | Tailwind CSS                   |
| i18n      | next-intl                      |
| Charts    | Recharts                       |
| Data      | localforage (GPX cache), fetch |

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
│   ├── store/        # Zustand slices, map-store, stub, types
│   ├── services/     # LocationService, MapService, base-map-provider
│   ├── config.ts     # App defaults (env overrides)
│   ├── gpx-cache.ts  # GPX fetch + localforage cache
│   ├── tile-cache.ts # Tile pre-caching, corridor generation, metadata, storage utils
│   └── utils.ts      # Formatting, URL parsing, boundary check, etc.
├── i18n/             # next-intl routing and request config
├── types/            # TypeScript definitions
└── messages/         # en.json, hr.json translations
```

---

## License

MIT - see [LICENSE](LICENSE).

---

## Acknowledgments

- Trail data: [Udruga Long Distance Trail Hrvatska (LDTH)](https://cldt.hr)
- Map tiles: OpenStreetMap, OpenTopoMap, CyclOSM, Esri, DGU

## TODO

- Refactor how dark mode styles are implemented.
