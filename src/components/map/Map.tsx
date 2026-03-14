'use client';

/**
 * Root Leaflet map: sets initial center/zoom from share URL or defaults, mounts BaseMapSelector and MapContent.
 * MapContent loads controls, trail polyline, markers, and share handler dynamically (no SSR).
 */
import React, { useMemo, useState } from 'react';
import { MapContainer } from 'react-leaflet';
import { LatLngTuple } from 'leaflet';
import dynamic from 'next/dynamic';
import { mapDefaults } from '@/lib/config';
import 'leaflet/dist/leaflet.css';
import { BaseMapProvider } from '@/lib/services/map-service';
import { parseShareUrlParams } from '@/lib/utils';

const MapContent = dynamic(() => import('./MapContent'), { ssr: false });
const BaseMapSelector = dynamic(() => import('./BaseMapSelector'), { ssr: false });

interface MapProps {
	defaultBaseMap?: string;
	locale?: string;
	zoomSnap?: number;
	className?: string;
}

export default function Map({
	defaultBaseMap = 'OpenStreetMap',
	locale: _locale = 'en',
	zoomSnap = 0,
	className = '',
}: MapProps): React.ReactElement {
	// Use share URL params for the initial view so the map opens at the correct position (no location permission needed)
	const initialView = useMemo((): { center: LatLngTuple; zoom: number } => {
		if (typeof window === 'undefined') return { center: mapDefaults.center as LatLngTuple, zoom: mapDefaults.zoom };
		const params = parseShareUrlParams();
		const hasViewParams =
			params?.lat !== null && params?.lat !== undefined && params?.lng !== null && params?.lng !== undefined;
		const hasProgressParams = params?.progress !== null;
		if (hasViewParams && !hasProgressParams) {
			return {
				center: [params.lat, params.lng] as LatLngTuple,
				zoom: params.zoom ?? mapDefaults.zoom,
			};
		}
		// For progress params, use zoom from URL if present (avoids jarring fitBounds before ShareUrlHandler flies)
		if (hasProgressParams && params) {
			return { center: mapDefaults.center as LatLngTuple, zoom: params.zoom ?? mapDefaults.zoom };
		}
		return { center: mapDefaults.center as LatLngTuple, zoom: mapDefaults.zoom };
	}, []);

	// Get initial base map provider from defaultBaseMap prop
	const initialProvider =
		Object.values(BaseMapProvider).find((provider) => provider === defaultBaseMap) || BaseMapProvider.OPEN_STREET_MAP;

	// Stable key per mount - do NOT include locale, so the map stays mounted across language switches.
	// Only translated text (tooltips, labels) changes via useTranslations; the Leaflet instance must persist.
	const [mapKey] = useState(() => `map-${Date.now()}-${Math.random().toString(36).slice(2)}`);

	return (
		<div className={`h-full w-full ${className}`}>
			<MapContainer
				scrollWheelZoom
				attributionControl={false}
				center={initialView.center}
				key={mapKey}
				style={{ height: '100%', width: '100%' }}
				wheelPxPerZoomLevel={5}
				zoom={initialView.zoom}
				zoomControl={false}
				zoomSnap={zoomSnap}
			>
				{/* Dynamic base map selector for changing map styles */}
				<BaseMapSelector initialProvider={initialProvider} />

				{/* Map content components */}
				<MapContent />
			</MapContainer>
		</div>
	);
}
