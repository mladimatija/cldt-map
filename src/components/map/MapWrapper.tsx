'use client';

/**
 * Wraps the Leaflet map in a dynamic import and shows a loading spinner until the map is ready.
 * Uses a short minimum display time to avoid a flash of empty content.
 * Renders GPX load the error banner above the map, so it is visible when trail fetch fails.
 * Listens for toggleMapFullscreen custom event and syncs isMapFullscreen to the map store.
 */
import { useState, useEffect, useRef, ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { config } from '@/lib/config';
import { useMapStore } from '@/lib/store';
import { MAP_FULLSCREEN_TOGGLE_EVENT } from '@/lib/map-events';

const GPXLoadErrorBanner = dynamic(() => import('@/components/map/GPXLoadErrorBanner'), { ssr: false });
const TrailNoticesBanner = dynamic(
	() => import('@/components/map/TrailNoticesBanner').then((m) => ({ default: m.TrailNoticesBanner })),
	{ ssr: false },
);

interface MapWrapperProps {
	locale?: string;
}

// Loading component with animation
function MapLoading({ text }: { text: string }): ReactElement {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center bg-white">
			<div className="relative mb-3 h-16 w-16">
				<div className="border-t-cldt-blue border-r-cldt-green border-b-cldt-blue border-l-cldt-green absolute top-0 left-0 h-full w-full animate-spin rounded-full border-4"></div>
				<div className="absolute top-[15%] left-[15%] h-[70%] w-[70%] rounded-full bg-white"></div>
			</div>
			<p className="text-lg font-medium text-gray-600">{text}</p>
		</div>
	);
}

function MapLoadingWithTranslation(): ReactElement {
	const t = useTranslations('mapWrapper');
	return <MapLoading text={t('initializingMap')} />;
}

const Map = dynamic(() => import('@/components/map/Map'), {
	ssr: false,
	loading: () => <MapLoadingWithTranslation />,
});

export default function MapWrapper(_props?: MapWrapperProps): ReactElement {
	const t = useTranslations('mapWrapper');
	const [isLoading, setIsLoading] = useState(true);
	const [loadingText, setLoadingText] = useState('');
	const mapContainerRef = useRef<HTMLDivElement>(null);

	// Brief minimum loading time to avoid flash (reduced from 2.5s for better UX).
	// loadingText is set here (not in useState) to avoid SSR/client hydration mismatch.
	useEffect(() => {
		const initTimer = setTimeout(() => setLoadingText(t('initializingMap')), 0);
		const textUpdateTimer = setTimeout(() => setLoadingText(t('loadingMapData')), 300);
		const loadingTimer = setTimeout(() => setIsLoading(false), 600);
		return () => {
			clearTimeout(initTimer);
			clearTimeout(loadingTimer);
			clearTimeout(textUpdateTimer);
		};
	}, [t]);

	// Listen for fullscreen toggle (dispatched by ZoomControls) and sync store on fullscreenchange
	useEffect(() => {
		if (isLoading) return;
		const el = mapContainerRef.current;
		if (!el) return;

		const onFullscreenChange = (): void => {
			useMapStore.getState().setMapFullscreen(document.fullscreenElement === el);
		};

		const onToggleFullscreen = (): void => {
			if (document.fullscreenElement === el) {
				void document.exitFullscreen();
			} else {
				void el.requestFullscreen();
			}
		};

		document.addEventListener('fullscreenchange', onFullscreenChange);
		window.addEventListener(MAP_FULLSCREEN_TOGGLE_EVENT, onToggleFullscreen);
		return () => {
			document.removeEventListener('fullscreenchange', onFullscreenChange);
			window.removeEventListener(MAP_FULLSCREEN_TOGGLE_EVENT, onToggleFullscreen);
		};
	}, [isLoading]);

	// Show loading state
	if (isLoading) {
		return <MapLoading text={loadingText} />;
	}

	return (
		<div className="relative flex h-full w-full flex-col">
			<GPXLoadErrorBanner />
			<TrailNoticesBanner />
			<div className="relative min-h-0 flex-1 bg-white" ref={mapContainerRef}>
				<Map defaultBaseMap={config.baseMapProvider} zoomSnap={0} />
			</div>
		</div>
	);
}
