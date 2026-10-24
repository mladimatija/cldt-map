'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { IoImageOutline, IoPrintOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { resolveShareUrlForCopy } from '@/lib/share-shortener-client';
import { collectShareTripStateFromStore, withShareTripState } from '@/lib/share-trip-state';
import { isPngExportDisabled } from '@/lib/export-utils';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { usePopoverFocusTrap } from '@/hooks';
import { MapControlIconButton } from './MapControlIconButton';
import { MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER, MAP_CONTROL_SECTION_DIVIDER } from './map-controls-constants';

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

/** Optional trip parts, in display order, with their label keys. */
const TRIP_PART_OPTIONS = [
	{ part: 'waypoints', labelKey: 'shareIncludeWaypoints' },
	{ part: 'progress', labelKey: 'shareIncludeProgress' },
	{ part: 'journal', labelKey: 'shareIncludeJournal' },
] as const;

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
	const showShareSection = canShare && !!longUrl;
	const pngDisabled = isPngExportDisabled(baseMapProvider);
	const panelTitleId = showShareSection ? 'share-panel-title' : 'share-export-panel-title';

	const includeTripState = useMapStore((s: MapStoreState) => s.shareIncludeTripState);
	const setIncludeTripState = useMapStore((s: MapStoreState) => s.setShareIncludeTripState);
	const tripParts = useMapStore((s: MapStoreState) => s.shareTripStateParts);
	const setTripParts = useMapStore((s: MapStoreState) => s.setShareTripStateParts);
	// Offer the trip option only when there is trip data to include.
	const [hasTripData] = useState(
		() =>
			collectShareTripStateFromStore({ plan: true, stars: true, waypoints: true, progress: true, journal: true }) !==
			null,
	);
	const withTrip = hasTripData && includeTripState;
	// The parent snapshots the view link when the panel opens; trip data, when
	// opted in, is added here so toggling an option rebuilds just this part.
	const linkUrl = useMemo(
		() => (longUrl && withTrip ? withShareTripState(longUrl, { plan: true, stars: true, ...tripParts }) : longUrl),
		[longUrl, withTrip, tripParts],
	);

	// A short link stores the link on map.cldt.hr, so one that carries trip data
	// is created only when asked for: ticking an option just to look uploads
	// nothing. Without short links, or offline, nothing leaves the device.
	const online = typeof navigator !== 'undefined' ? navigator.onLine : false;
	const needsUploadConsent = withTrip && useShortLinks && online;
	const [uploadApprovedFor, setUploadApprovedFor] = useState<string | null>(null);
	const mayResolve = !needsUploadConsent || uploadApprovedFor === linkUrl;

	const [resolved, setResolved] = useState<{ from: string; url: string; short: boolean } | null>(null);
	useEffect(() => {
		if (!showShareSection || !linkUrl || !mayResolve) return;
		let cancelled = false;
		void resolveShareUrlForCopy(linkUrl, {
			useShortLinks,
			online: typeof navigator !== 'undefined' ? navigator.onLine : false,
		}).then(({ url, short }) => {
			if (!cancelled) setResolved({ from: linkUrl, url, short });
		});
		return () => {
			cancelled = true;
		};
	}, [linkUrl, showShareSection, useShortLinks, mayResolve]);
	// A result for an older link (before an option changed) is not shown.
	const current = resolved?.from === linkUrl ? resolved : null;
	const awaitingConsent = showShareSection && !mayResolve;
	const loading = showShareSection && mayResolve && !current;
	const displayUrl = current?.url ?? null;
	const isShort = current?.short ?? false;

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
					{hasTripData ? (
						<div className="flex flex-col gap-1.5">
							<label className="flex cursor-pointer items-start gap-2 text-xs text-gray-700 dark:text-[var(--text-primary)]">
								<Checkbox checked={includeTripState} onCheckedChange={setIncludeTripState} />
								<span className="min-w-0">
									<span className="block font-medium">{t('shareIncludeTrip')}</span>
									<span className="block text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
										{t('shareIncludeTripHint')}
									</span>
								</span>
							</label>
							{includeTripState ? (
								<div className="ml-6 flex flex-col gap-1">
									{TRIP_PART_OPTIONS.map(({ part, labelKey }) => (
										<label
											className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-[var(--text-primary)]"
											key={part}
										>
											<Checkbox
												checked={tripParts[part]}
												onCheckedChange={(checked) => setTripParts({ ...tripParts, [part]: checked })}
											/>
											<span>{t(labelKey)}</span>
										</label>
									))}
									{useShortLinks ? (
										<p className="m-0 text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
											{t('shareTripStoredNote')}
										</p>
									) : null}
								</div>
							) : null}
						</div>
					) : null}
					<div
						aria-busy={loading}
						className="flex justify-center rounded-md border border-gray-100 bg-white p-3 dark:border-[var(--border-color)]"
					>
						{awaitingConsent ? (
							<div className="flex h-[200px] w-[200px] items-center justify-center">
								<Button size="sm" variant="mapControlOutline" onClick={() => setUploadApprovedFor(linkUrl)}>
									{t('shareCreateTripLink')}
								</Button>
							</div>
						) : loading || !displayUrl ? (
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
						<p className="m-0 text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
							{t('shareQrLongFallback')}
						</p>
					) : null}
					{isShort && !loading ? (
						<p className="m-0 text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
							{t('shareQrShortNote')}
						</p>
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

			<div className={showShareSection ? MAP_CONTROL_SECTION_DIVIDER : undefined}>
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
