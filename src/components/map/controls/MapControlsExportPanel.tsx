'use client';

import React, { type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { isPngExportDisabled } from '@/lib/export-utils';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';

interface MapControlsExportPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
	baseMapProvider: string;
	onPrint: () => void;
	onPngDownload: () => void;
	onClose: () => void;
}

/** Export panel: Print/PDF and PNG download buttons for the current map view. */
export function MapControlsExportPanel({
	containerRef,
	baseMapProvider,
	onPrint,
	onPngDownload,
	onClose,
}: MapControlsExportPanelProps): React.ReactElement {
	const t = useTranslations('mapExport');
	const pngDisabled = isPngExportDisabled(baseMapProvider);

	return (
		<div
			aria-labelledby="export-panel-title"
			className={`z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-80 -translate-y-1/2 flex-col gap-2 ${MAP_CONTROL_POPOVER}`}
			ref={containerRef}
			onContextMenu={(e) => e.preventDefault()}
		>
			<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="export-panel-title">
				{t('title')}
			</h3>
			<div className="flex flex-col gap-2">
				<Button variant="mapControlOutline" onClick={onPrint}>
					{t('printButton')}
				</Button>

				{pngDisabled ? (
					<SmartTooltip content={t('pngDisabledTooltip')} position="left">
						<Button disabled aria-label={t('pngLabel')} variant="mapControlOutline">
							{t('pngButton')}
						</Button>
					</SmartTooltip>
				) : (
					<Button aria-label={t('pngLabel')} variant="mapControlOutline" onClick={onPngDownload}>
						{t('pngButton')}
					</Button>
				)}

				<Button aria-label={t('cancel')} variant="mapControlOutlineSecondary" onClick={onClose}>
					{t('cancel')}
				</Button>
			</div>
		</div>
	);
}
