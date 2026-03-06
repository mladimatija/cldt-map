'use client';

/**
 * 2-step hint shown when the distance ruler is enabled. Persisted dismissal in localStorage.
 */
import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';

const RULER_HINT_DISMISSED_KEY = 'cldt-map-ruler-hint-dismissed';

export function RulerHint(): React.ReactElement | null {
	const t = useTranslations('mapControls');
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const [isDismissed, setIsDismissed] = useState(true);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		const stored = localStorage.getItem(RULER_HINT_DISMISSED_KEY);
		queueMicrotask(() => setIsDismissed(stored === '1'));
	}, []);

	const handleDismiss = (): void => {
		localStorage.setItem(RULER_HINT_DISMISSED_KEY, '1');
		setIsDismissed(true);
	};

	if (!isRulerEnabled || isDismissed) {
		return null;
	}

	return (
		<div
			aria-live="polite"
			className="map-tooltip map-tooltip--narrow z-controls absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col gap-1"
			role="status"
		>
			<div className="relative flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p>{t('rulerHintStep1')}</p>
					<p>{t('rulerHintStep2')}</p>
				</div>
				<Button
					aria-label={t('rulerHintDismiss')}
					className="user-location-close-btn"
					variant="closeIcon"
					onClick={handleDismiss}
				>
					×
				</Button>
			</div>
		</div>
	);
}
