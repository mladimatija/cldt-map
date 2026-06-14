/**
 * Walk simulator: a fake hiker that moves along the trail.
 *
 * Drives the same store paths a real GPS fix does (map-store userLocation +
 * main-store closestPoint), so everything downstream reacts exactly as in
 * the field: location tooltip, distance/ETA HUD, weather fetch, completion
 * auto-track, off-route alert, GPS-triggered banners, predictive precache.
 * The lateral-offset control walks parallel to the trail at a chosen
 * distance, which is how you exercise the off-route machine and the
 * proximity banners without editing code.
 *
 * The timer and trail geometry live at module scope, so a walk started on
 * the /test page keeps going while you switch to the map page to watch.
 * UI state is mirrored into `mapStore.walkSim` for rendering. Production
 * use is limited to the public /demo route; dev controls stay on /test.
 */

import { useMapStore, useStore } from '@/lib/store';
import { haversineDistanceM } from '@/lib/haversine';
import { L } from '@/lib/store/leaflet';
import type { TrailDirection } from '@/lib/types';

export interface WalkSimState {
	running: boolean;
	posKm: number;
	speedKmh: number;
	walkDirection: TrailDirection;
	offsetM: number;
	totalKm: number;
}

const TICK_MS = 1000;
const M_PER_DEG_LAT = 111_320;

let timer: ReturnType<typeof setInterval> | null = null;
let points: { lat: number; lng: number }[] = [];
let cumM: number[] = [];
let posM = 0;
let speedKmh = 4;
let walkDirection: TrailDirection = 'SOBO';
let offsetM = 0;
let lastIdx = 0;
let loopAtEnds = false;
let loopStartM = 0;

async function loadTrail(): Promise<boolean> {
	if (points.length > 1) return true;
	const main = useStore.getState();
	const enhanced = main.enhancedTrailPoints ?? [];
	if (enhanced.length > 1) {
		points = enhanced.map((p) => ({ lat: p.lat, lng: p.lng }));
	} else {
		const { fetchAndParseTrailPoints } = await import('./gpx-cache');
		points = await fetchAndParseTrailPoints();
	}
	if (points.length < 2) return false;
	cumM = new Array<number>(points.length);
	cumM[0] = 0;
	for (let i = 1; i < points.length; i++) {
		cumM[i] = cumM[i - 1] + haversineDistanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
	}
	return true;
}

function totalKm(): number {
	return cumM.length > 0 ? cumM[cumM.length - 1] / 1000 : 0;
}

/** Index of the trail point at `m` metres from start; pointer-based so each
 *  tick is O(steps moved), with a reset when the position jumps backwards. */
function indexAt(m: number): number {
	if (lastIdx >= cumM.length || cumM[lastIdx] > m) lastIdx = 0;
	while (lastIdx < cumM.length - 1 && cumM[lastIdx + 1] <= m) lastIdx++;
	return lastIdx;
}

function mirrorState(running: boolean): void {
	useMapStore.getState().setWalkSim({
		running,
		posKm: posM / 1000,
		speedKmh,
		walkDirection,
		offsetM,
		totalKm: totalKm(),
	});
}

/** Pushes the simulated fix through the same store fields a real GPS fix
 *  reaches, including a manually assembled closestPoint - on the /test page
 *  the map's own closest-point pipeline is not running, and on the map page
 *  setting `closestPointCalculated` keeps the two from fighting. */
function applyPosition(): void {
	const idx = indexAt(posM);
	const base = points[idx];
	const next = points[Math.min(idx + 1, points.length - 1)];
	// Trail bearing -> offset perpendicular to the left of travel.
	const bearingRad = Math.atan2((next.lng - base.lng) * Math.cos((base.lat * Math.PI) / 180), next.lat - base.lat);
	const sideRad = bearingRad + Math.PI / 2;
	const lat = base.lat + (offsetM * Math.cos(sideRad)) / M_PER_DEG_LAT;
	const lng = base.lng + (offsetM * Math.sin(sideRad)) / (M_PER_DEG_LAT * Math.cos((base.lat * Math.PI) / 180));

	const location = { lat, lng, accuracy: 10 };
	const mapStore = useMapStore.getState();
	const main = useStore.getState();
	mapStore.setUserLocation(location);
	main.setUserLocation(location);
	main.setClosestPoint({
		// Leaflet LatLng instance to match the ClosestPoint type; the sim only
		// ever runs client-side where the SSR-guarded L is loaded.
		point: L.latLng(base.lat, base.lng),
		distance: offsetM,
		distanceFromStart: posM,
		distanceToEnd: Math.max(0, cumM[cumM.length - 1] - posM),
	});
	main.setClosestPointCalculated(true);
}

function tick(): void {
	const stepM = ((speedKmh * 1000) / 3600) * (TICK_MS / 1000);
	posM += walkDirection === 'SOBO' ? stepM : -stepM;
	const endM = cumM[cumM.length - 1];
	if (posM <= 0 || posM >= endM) {
		if (loopAtEnds) {
			posM = loopStartM;
			lastIdx = 0;
			applyPosition();
			mirrorState(true);
			return;
		}
		posM = Math.max(0, Math.min(endM, posM));
		applyPosition();
		pauseWalkSim();
		return;
	}
	applyPosition();
	mirrorState(true);
}

export async function startWalkSim(config: {
	startKm: number;
	speedKmh: number;
	walkDirection: TrailDirection;
	offsetM: number;
	/** When true, reaching either trail end jumps back to the start km (demo hike). */
	loopAtEnds?: boolean;
}): Promise<boolean> {
	if (!(await loadTrail())) return false;
	speedKmh = config.speedKmh;
	walkDirection = config.walkDirection;
	offsetM = config.offsetM;
	loopAtEnds = config.loopAtEnds ?? false;
	posM = Math.max(0, Math.min(cumM[cumM.length - 1], config.startKm * 1000));
	loopStartM = posM;
	lastIdx = 0;
	const mapStore = useMapStore.getState();
	mapStore.setFakeUserLocationEnabled(true);
	applyPosition();
	if (timer) clearInterval(timer);
	timer = setInterval(tick, TICK_MS);
	mirrorState(true);
	return true;
}

export function pauseWalkSim(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	if (cumM.length > 0) mirrorState(false);
}

export function resumeWalkSim(): void {
	if (timer || cumM.length === 0) return;
	timer = setInterval(tick, TICK_MS);
	mirrorState(true);
}

/** Stops the walk and clears the sim state; the fake location stays at the
 *  last position until released explicitly. */
export function stopWalkSim(): void {
	pauseWalkSim();
	useMapStore.getState().setWalkSim(null);
}

/** Live-adjustable while walking. */
export function setWalkSimSpeed(value: number): void {
	speedKmh = Math.max(0.1, value);
	if (cumM.length > 0) mirrorState(timer !== null);
}

export function setWalkSimOffset(value: number): void {
	offsetM = Math.max(0, value);
	if (cumM.length > 0) {
		applyPosition();
		mirrorState(timer !== null);
	}
}

export function setWalkSimDirection(value: TrailDirection): void {
	walkDirection = value;
	if (cumM.length > 0) mirrorState(timer !== null);
}

/** Hands GPS back to the real device: stops the walk and disables the fake
 *  location flag. */
export function releaseWalkSim(): void {
	stopWalkSim();
	const mapStore = useMapStore.getState();
	mapStore.setFakeUserLocationEnabled(false);
	mapStore.setUserLocation(null);
	useStore.getState().setClosestPoint(null);
}
