/**
 * Trail geometry helpers: compute total distance and elevation gain/loss from point arrays.
 * Used by the map and controls to show trail stats (e.g., in MapControls, TrailRoute).
 */
import L from 'leaflet';
import { MapError } from '@/lib/utils';

interface TrailMetadata {
	startPoint: L.LatLng;
	endPoint: L.LatLng;
	totalDistance: number;
	elevationGain: number;
	elevationLoss: number;
}

/**
 * Calculate trail metadata (distance, elevation gain/loss) from points
 * @param points Trail points as LatLng
 * @param elevationPoints Optional elevation data per point
 * @returns Trail metadata with total distance in meters
 */
export function calculateTrailMetadata(
	points: L.LatLng[],
	elevationPoints?: { lat: number; lng: number; elevation: number }[],
): TrailMetadata {
	if (!points || points.length === 0) {
		throw new MapError('Cannot calculate trail metadata: no points provided');
	}

	const startPoint = points[0];
	const endPoint = points[points.length - 1];

	let totalDistance = 0;
	for (let i = 1; i < points.length; i++) {
		totalDistance += points[i - 1].distanceTo(points[i]);
	}

	// Sum positive elevation deltas as gain, negative as loss (in meters).
	let elevationGain = 0;
	let elevationLoss = 0;
	if (elevationPoints && elevationPoints.length > 1) {
		for (let i = 1; i < elevationPoints.length; i++) {
			const diff = elevationPoints[i].elevation - elevationPoints[i - 1].elevation;
			if (diff > 0) {
				elevationGain += diff;
			} else {
				elevationLoss += Math.abs(diff);
			}
		}
	}

	return {
		startPoint,
		endPoint,
		totalDistance,
		elevationGain,
		elevationLoss,
	};
}
