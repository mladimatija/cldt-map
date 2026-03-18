'use client';

/**
 * Manages the RainViewer precipitation radar tile layers on the Leaflet map.
 *
 * All frame tile layers are created upfront at opacity 0. Frame animation is done
 * by toggling opacity (not removing/adding layers), so tiles remain browser-cached
 * and do not get re-fetched on every frame advance.
 *
 * Uses a dedicated 'radarPane' so base-map swaps don't remove radar layers.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';

const RADAR_PANE = 'radarPane';
const RADAR_PANE_Z = 450;
const REFRESH_MS = 5 * 60 * 1000;
const RADAR_API = 'https://api.rainviewer.com/public/weather-maps.json';
const TILE_OPTIONS: L.TileLayerOptions = {
	pane: RADAR_PANE,
	opacity: 0,
	attribution: 'Radar: <a href="https://www.rainviewer.com">RainViewer</a>',
	maxNativeZoom: 6,
	maxZoom: 18,
};

interface RainViewerResponse {
	host: string;
	radar: {
		past: Array<{ time: number; path: string }>;
		nowcast: Array<{ time: number; path: string }>;
	};
}

export function RadarOverlay(): null {
	const map = useMap();
	const showRadarOverlay = useMapStore((state: MapStoreState) => state.showRadarOverlay);
	const radarFrames = useMapStore((state: MapStoreState) => state.radarFrames);
	const radarFrameIndex = useMapStore((state: MapStoreState) => state.radarFrameIndex);
	const setRadarFrames = useMapStore((state: MapStoreState) => state.setRadarFrames);
	const setRadarFrameIndex = useMapStore((state: MapStoreState) => state.setRadarFrameIndex);
	const setRadarPlaying = useMapStore((state: MapStoreState) => state.setRadarPlaying);

	// One Leaflet TileLayer per frame — never recreated during animation.
	const layersRef = useRef<L.TileLayer[]>([]);
	// Track the frames array reference so we can detect a refresh.
	const prevFramesRef = useRef<typeof radarFrames>([]);

	// Create pane once on mount.
	useEffect(() => {
		if (!map.getPane(RADAR_PANE)) {
			map.createPane(RADAR_PANE);
			const pane = map.getPane(RADAR_PANE);
			if (pane) pane.style.zIndex = String(RADAR_PANE_Z);
		}
	}, [map]);

	// Fetch frame metadata when overlay is enabled; clean up when disabled.
	useEffect(() => {
		if (!showRadarOverlay) {
			layersRef.current.forEach((l) => map.removeLayer(l));
			layersRef.current = [];
			setRadarFrames([]);
			setRadarPlaying(false);
			return;
		}

		let cancelled = false;

		const fetchFrames = async (): Promise<void> => {
			try {
				const res = await fetch(RADAR_API);
				if (!res.ok || cancelled) return;
				const data = (await res.json()) as RainViewerResponse;
				const past = data.radar?.past ?? [];
				const nowcast = data.radar?.nowcast ?? [];
				if (cancelled) return;

				const frames = [...past, ...nowcast].map((f) => ({
					time: f.time,
					url: `${data.host}${f.path}/256/{z}/{x}/{y}/4/1_1.png`,
				}));

				if (!frames.length || cancelled) return;
				setRadarFrames(frames);
				setRadarFrameIndex(0);
				setRadarPlaying(true);
			} catch {
				// network error — silently ignore
			}
		};

		void fetchFrames();
		const interval = setInterval(() => void fetchFrames(), REFRESH_MS);

		return () => {
			cancelled = true;
			clearInterval(interval);
			layersRef.current.forEach((l) => map.removeLayer(l));
			layersRef.current = [];
		};
	}, [map, showRadarOverlay, setRadarFrames, setRadarFrameIndex, setRadarPlaying]);

	// Build/rebuild tile layers when the frames array changes, then show the active frame.
	// On subsequent frame-index changes only the opacity toggle runs — no layer creation.
	useEffect(() => {
		if (!showRadarOverlay || !radarFrames.length) return;

		// Rebuild only when the frames reference has changed (initial load or 5-min refresh).
		if (prevFramesRef.current !== radarFrames) {
			prevFramesRef.current = radarFrames;
			layersRef.current.forEach((l) => map.removeLayer(l));
			layersRef.current = radarFrames.map((frame) => L.tileLayer(frame.url, TILE_OPTIONS).addTo(map));
		}

		// Reveal only the active frame; keep all others invisible.
		layersRef.current.forEach((l, i) => l.setOpacity(i === radarFrameIndex ? 0.7 : 0));
	}, [map, showRadarOverlay, radarFrames, radarFrameIndex]);

	return null;
}
