'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { IoImageOutline, IoPrintOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { resolveShareUrlForCopy } from '@/lib/share-shortener-client';
import { isPngExportDisabled } from '@/lib/export-utils';
import { usePopoverFocusTrap } from '@/hooks';
import { MapControlIconButton } from './MapControlIconButton';
import { MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from './map-controls-constants';

const SECTION_DIVIDER = 'border-t border-gray-200 pt-3 dark:border-[var(--border-color)]';

const ShareQrLoader: React.FC<{ label?: string }> = ({ label }) => (
	<div
		className="flex h-[200px] w-[200px] items-center justify-center"
		{...(label ? { 'aria-label': label, role: 'status' as const } : { 'aria-hidden': true })}
	>
		<div
			aria-hidden
			className="border-t-cldt-blue h-10 w-10 animate-spin rounded-full border-4 border-gray-200 motion-reduce:animate-none dark:border-[var(--border-color)]"
		/>
	</div>
);

const QRCode = dynamic(() => import('react-qr-code'), {
	ssr: false,
	loading: () => <ShareQrLoader />,
});

interface MapControlsSharePanelProps {
	longUrl: string | null;
	canShare: boolean;
	useShortLinks: boolean;
	baseMapProvider: string;
	onCopy: (finalUrl: string, short: boolean) => void;
	onPrint: () => void;
	onPngDownload: () => void;
}

/** Share popover: QR code and copy link, plus print/PNG export for the current map view. */
export function MapControlsSharePanel({
	longUrl,
	canShare,
	useShortLinks,
	baseMapProvider,
	onCopy,
	onPrint,
	onPngDownload,
}: MapControlsSharePanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const tExport = useTranslations('mapExport');
	const tCommon = useTranslations('common');
	const loadingLabel = tCommon('loading');
	const popoverRef = usePopoverFocusTrap(true);
	const snapshotUrlRef = useRef(longUrl);
	const showShareSection = canShare && !!longUrl;
	const [displayUrl, setDisplayUrl] = useState<string | null>(null);
	const [isShort, setIsShort] = useState(false);
	const [loading, setLoading] = useState(showShareSection);
	const pngDisabled = isPngExportDisabled(baseMapProvider);
	const panelTitleId = showShareSection ? 'share-panel-title' : 'share-export-panel-title';

	useEffect(() => {
		if (!showShareSection || !longUrl) return;
		snapshotUrlRef.current = longUrl;
		let cancelled = false;
		void resolveShareUrlForCopy(snapshotUrlRef.current, {
			useShortLinks,
			online: typeof navigator !== 'undefined' ? navigator.onLine : false,
		}).then(({ url, short }) => {
			if (cancelled) return;
			setDisplayUrl(url);
			setIsShort(short);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
		// Resolve once per panel mount; parent snapshots longUrl when the panel opens.
	}, [longUrl, showShareSection, useShortLinks]);

	return (
		<div
			aria-labelledby={panelTitleId}
			aria-modal="true"
			className={`z-controls-popover fixed top-2 right-16 flex ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-3 ${MAP_CONTROL_POPOVER}`}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			{showShareSection ? (
				<>
					<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="share-panel-title">
						{t('shareTitle')}
					</h3>
					<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('shareQrHint')}</p>
					<div
						aria-busy={loading || !displayUrl}
						className="flex justify-center rounded-md border border-gray-100 bg-white p-3 dark:border-[var(--border-color)]"
					>
						{loading || !displayUrl ? (
							<ShareQrLoader label={loadingLabel} />
						) : (
							<div aria-label={t('shareQrLabel')} role="img">
								<QRCode level="M" size={200} value={displayUrl} />
							</div>
						)}
					</div>
					{displayUrl && !loading && isShort ? (
						<p className="m-0 text-xs break-all text-gray-600 dark:text-[var(--text-secondary)]">{displayUrl}</p>
					) : null}
					{displayUrl && !loading && !isShort ? (
						<p className="m-0 text-[10px] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
							{t('shareQrLongFallback')}
						</p>
					) : null}
					{isShort && !loading ? (
						<p className="m-0 text-[10px] text-gray-500 dark:text-[var(--text-secondary)]">{t('shareQrShortNote')}</p>
					) : null}
					<Button
						disabled={!displayUrl || loading}
						size="sm"
						variant="mapControlOutline"
						onClick={() => onCopy(displayUrl!, isShort)}
					>
						{t('copyLink')}
					</Button>
				</>
			) : null}

			<div className={showShareSection ? SECTION_DIVIDER : undefined}>
				{showShareSection ? (
					<h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">{tExport('title')}</h4>
				) : (
					<h3
						className="mb-1 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
						id="share-export-panel-title"
					>
						{tExport('title')}
					</h3>
				)}
				<p className="m-0 mb-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{tExport('hint')}</p>
				<div className="flex gap-2">
					<SmartTooltip content={tExport('printLabel')} position="left">
						<MapControlIconButton aria-label={tExport('printLabel')} variant="mapControlOutline" onClick={onPrint}>
							<IoPrintOutline aria-hidden className="h-4 w-4" />
						</MapControlIconButton>
					</SmartTooltip>

					{pngDisabled ? (
						<SmartTooltip content={tExport('pngDisabledTooltip')} position="left">
							<MapControlIconButton disabled aria-label={tExport('pngLabel')} variant="mapControlOutline">
								<IoImageOutline aria-hidden className="h-4 w-4" />
							</MapControlIconButton>
						</SmartTooltip>
					) : (
						<SmartTooltip content={tExport('pngLabel')} position="left">
							<MapControlIconButton
								aria-label={tExport('pngLabel')}
								variant="mapControlOutline"
								onClick={onPngDownload}
							>
								<IoImageOutline aria-hidden className="h-4 w-4" />
							</MapControlIconButton>
						</SmartTooltip>
					)}
				</div>
			</div>
		</div>
	);
}
