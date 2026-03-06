'use client';

/**
 * 2-step hint shown when the distance ruler is enabled. Persisted dismissal in localStorage.
 */
import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoClose } from 'react-icons/io5';

const RULER_HINT_DISMISSED_KEY = 'cldt-map-ruler-hint-dismissed';

export function RulerHint(): React.ReactElement | null {
	const t = useTranslations('mapControls');
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const [isDismissed, setIsDismissed] = useState(true);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		const stored = localStorage.getItem(RULER_HINT_DISMISSED_KEY);
		setIsDismissed(stored === '1');
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
			className="z-controls absolute bottom-24 left-1/2 flex max-w-[280px] -translate-x-1/2 flex-col gap-1 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-md dark:border-gray-600 dark:bg-gray-800/95"
			role="status"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="text-left text-xs text-gray-700 dark:text-gray-200">
					<p>{t('rulerHintStep1')}</p>
					<p className="text-gray-600 dark:text-gray-300">{t('rulerHintStep2')}</p>
				</div>
				<button
					aria-label={t('rulerHintDismiss')}
					className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
					onClick={handleDismiss}
					type="button"
				>
					<IoClose className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}
