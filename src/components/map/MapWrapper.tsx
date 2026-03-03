'use client';

/**
 * Wraps the Leaflet map in a dynamic import and shows a loading spinner until the map is ready.
 * Uses a short minimum display time to avoid a flash of empty content.
 * Renders GPX load the error banner above the map, so it is visible when trail fetch fails.
 */
import { useState, useEffect, ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { config } from '@/lib/config';

const GPXLoadErrorBanner = dynamic(() => import('@/components/map/GPXLoadErrorBanner'), { ssr: false });

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
	const [loadingText, setLoadingText] = useState(t('initializingMap'));

	// Brief minimum loading time to avoid flash (reduced from 2.5s for better UX)
	useEffect(() => {
		const textUpdateTimer = setTimeout(() => {
			setLoadingText(t('loadingMapData'));
		}, 300);
		const loadingTimer = setTimeout(() => {
			setIsLoading(false);
		}, 600);
		return () => {
			clearTimeout(loadingTimer);
			clearTimeout(textUpdateTimer);
		};
	}, [t]);

	// Show loading state
	if (isLoading) {
		return <MapLoading text={loadingText} />;
	}

	return (
		<div className="relative flex h-full w-full flex-col">
			<GPXLoadErrorBanner />
			<div className="relative min-h-0 flex-1">
				<Map defaultBaseMap={config.baseMapProvider} zoomSnap={0} />
			</div>
		</div>
	);
}
