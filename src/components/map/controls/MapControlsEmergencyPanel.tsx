'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { OpenLocationCode } from 'open-location-code';
import { IoCallOutline, IoCopyOutline, IoOpenOutline, IoWarningOutline } from 'react-icons/io5';
import { MAP_CONTROL_SECTION_HEADING } from './MapControlSectionCard';
import { MapControlIconButton } from './MapControlIconButton';
import { Button, buttonVariants } from '@/components/ui/Button';
import { usePopoverFocusTrap } from '@/hooks';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { computeBearing, findNearestPointIndex, formatDistanceM } from '@/lib/distance-utils';
import {
	bearingToCompass,
	findNearestEntry,
	loadEmergencyData,
	type HgssStation,
	type RoadAccessEntry,
} from '@/lib/emergency-data';
import { fetchReverseGeocodeAddress } from '@/lib/reverse-geocode-client';
import { cn, isSafeUrl } from '@/lib/utils';

const COPY_RESET_MS = 1500;

const SECTION_DIVIDER = 'border-t border-gray-200 pt-3 dark:border-[var(--border-color)]';

interface MapControlsEmergencyPanelProps {
	onClose: () => void;
}

interface NearestRoad {
	entry: RoadAccessEntry;
	distanceM: number;
	bearingDeg: number;
}

interface NearestHgss {
	entry: HgssStation;
	distanceM: number;
	bearingDeg: number;
}

type CopyField = 'coords' | 'plusCode' | 'section' | 'address' | 'all';

async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator?.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* empty */
	}
	try {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'absolute';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		const success = document.execCommand('copy');
		document.body.removeChild(textarea);
		return success;
	} catch {
		return false;
	}
}

interface CopyButtonProps {
	value: string;
	ariaLabel: string;
	field: CopyField;
	copiedField: CopyField | null;
	onCopied: (field: CopyField) => void;
}

function CopyButton({ value, ariaLabel, field, copiedField, onCopied }: CopyButtonProps): React.ReactElement {
	const t = useTranslations('emergency');
	const isCopied = copiedField === field;
	const handleClick = (): void => {
		void copyTextToClipboard(value).then((ok) => {
			if (ok) onCopied(field);
		});
	};
	return (
		<MapControlIconButton
			aria-label={ariaLabel}
			className={cn(isCopied && 'text-cldt-green')}
			title={isCopied ? t('copyTooltipSuccess') : t('copyTooltipDefault')}
			onClick={handleClick}
		>
			<IoCopyOutline aria-hidden className="h-3.5 w-3.5" />
		</MapControlIconButton>
	);
}

function CompassBearing({
	bearingDeg,
	compass,
	label,
}: {
	bearingDeg: number;
	compass: string;
	label: string;
}): React.ReactElement {
	return (
		<span aria-label={label} className="inline-flex shrink-0 items-center gap-1 text-xs" role="img" title={label}>
			<span
				aria-hidden="true"
				className="text-cldt-blue inline-block"
				style={{ transform: `rotate(${bearingDeg}deg)` }}
			>
				&#8593;
			</span>
			<span aria-hidden="true" className="font-medium">
				{compass}
			</span>
		</span>
	);
}

const olc = new OpenLocationCode();
const LOCALISABLE_ROAD_TYPES = new Set(['unclassified', 'residential', 'road']);

function formatPhoneDisplay(phone: string): string {
	const m = /^\+(\d{1,3})(\d{2,3})(\d{3})(\d{3,4})$/.exec(phone);
	return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

export function MapControlsEmergencyPanel({ onClose }: MapControlsEmergencyPanelProps): React.ReactElement {
	const t = useTranslations('emergency');
	const tTrail = useTranslations('trailRoute');
	const locale = useLocale();

	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const permissionStatus = useMapStore((s: MapStoreState) => s.permissionStatus);
	const locationError = useMapStore((s: MapStoreState) => s.locationError);
	const units = useMapStore((s: MapStoreState) => s.units);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const [roadAccess, setRoadAccess] = useState<RoadAccessEntry[] | null>(null);
	const [hgssStations, setHgssStations] = useState<HgssStation[] | null>(null);
	const [copiedField, setCopiedField] = useState<CopyField | null>(null);
	const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [addressLookup, setAddressLookup] = useState<{ key: string; line: string | null } | null>(null);
	const cardRef = usePopoverFocusTrap(true);

	useEffect(() => {
		let cancelled = false;
		void loadEmergencyData()
			.then(({ roadAccess: ra, hgssStations: hg }) => {
				if (cancelled) return;
				setRoadAccess(ra);
				setHgssStations(hg);
			})
			.catch(() => {
				if (cancelled) return;
				setRoadAccess([]);
				setHgssStations([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const handler = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [onClose]);

	useEffect(
		() => () => {
			if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current);
		},
		[],
	);

	const handleCopied = useCallback((field: CopyField): void => {
		setCopiedField(field);
		if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current);
		copyResetTimerRef.current = setTimeout(() => {
			setCopiedField(null);
			copyResetTimerRef.current = null;
		}, COPY_RESET_MS);
	}, []);

	const gpsUnavailable = !userLocation || permissionStatus !== 'granted' || locationError !== null;

	const displayPosition: { lat: number; lng: number; source: 'gps' | 'closest' | null } = useMemo(() => {
		if (userLocation) {
			return { lat: userLocation.lat, lng: userLocation.lng, source: 'gps' };
		}
		if (closestPoint) {
			return { lat: closestPoint.point.lat, lng: closestPoint.point.lng, source: 'closest' };
		}
		return { lat: 0, lng: 0, source: null };
	}, [userLocation, closestPoint]);

	const plusCode = useMemo(
		() => (displayPosition.source === null ? '' : olc.encode(displayPosition.lat, displayPosition.lng, 10)),
		[displayPosition],
	);

	const coordsString = useMemo(
		() =>
			displayPosition.source === null ? '' : `${displayPosition.lat.toFixed(5)}, ${displayPosition.lng.toFixed(5)}`,
		[displayPosition],
	);

	const sectionInfo = useMemo<{ sectionName: string | null; km: number | null }>(() => {
		if (!closestPoint || !enhancedTrailPoints || enhancedTrailPoints.length === 0) {
			return { sectionName: null, km: null };
		}
		const p = enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, closestPoint.distanceFromStart)];
		return {
			sectionName: p?.sectionName ?? null,
			km: p ? p.distanceFromStart / 1000 : null,
		};
	}, [enhancedTrailPoints, closestPoint]);

	const nearestRoad: NearestRoad | null = useMemo(() => {
		if (displayPosition.source === null || roadAccess === null) return null;
		return findNearestEntry(roadAccess, displayPosition.lat, displayPosition.lng, computeBearing);
	}, [roadAccess, displayPosition]);

	const nearestHgss: NearestHgss | null = useMemo(() => {
		if (displayPosition.source === null || hgssStations === null) return null;
		return findNearestEntry(hgssStations, displayPosition.lat, displayPosition.lng, computeBearing);
	}, [hgssStations, displayPosition]);

	const roadLabel = useMemo((): string => {
		if (!nearestRoad) return '';
		const ref = nearestRoad.entry.roadRef;
		const displayRef = LOCALISABLE_ROAD_TYPES.has(ref) ? t(`roadType.${ref}`) : ref;
		return t('crossroadsAt', { distance: formatDistanceM(nearestRoad.distanceM, units), ref: displayRef });
	}, [nearestRoad, units, t]);

	const roadCompass = useMemo(() => (nearestRoad ? bearingToCompass(nearestRoad.bearingDeg) : null), [nearestRoad]);
	const hgssCompass = useMemo(() => (nearestHgss ? bearingToCompass(nearestHgss.bearingDeg) : null), [nearestHgss]);

	const sectionString = useMemo((): string => {
		const { sectionName, km } = sectionInfo;
		if (sectionName === null && km === null) return '';
		const localisedName = sectionName ? tTrail(sectionName) : null;
		const parts = [localisedName, km !== null ? t('kmFromStart', { km: km.toFixed(2) }) : null].filter(
			(p): p is string => p !== null,
		);
		return parts.join(' - ');
	}, [sectionInfo, t, tTrail]);

	const hasPosition = displayPosition.source !== null;

	const addressLookupKey = useMemo(() => {
		if (!hasPosition || (typeof navigator !== 'undefined' && !navigator.onLine)) return '';
		return `${displayPosition.lat.toFixed(4)},${displayPosition.lng.toFixed(4)},${locale}`;
	}, [hasPosition, displayPosition.lat, displayPosition.lng, locale]);

	useEffect(() => {
		if (!addressLookupKey) return;
		let cancelled = false;
		const lat = Number(addressLookupKey.split(',')[0]);
		const lng = Number(addressLookupKey.split(',')[1]);
		void fetchReverseGeocodeAddress(lat, lng, locale).then((line) => {
			if (cancelled) return;
			setAddressLookup({ key: addressLookupKey, line });
		});
		return () => {
			cancelled = true;
		};
	}, [addressLookupKey, locale]);

	const addressLine = addressLookup?.key === addressLookupKey && addressLookup.line ? addressLookup.line : null;
	const addressLoading = Boolean(addressLookupKey && addressLookup?.key !== addressLookupKey);

	const mapsHref = useMemo(() => {
		if (!hasPosition) return undefined;
		const lat = displayPosition.lat.toFixed(6);
		const lng = displayPosition.lng.toFixed(6);
		const isMobile =
			typeof window !== 'undefined' &&
			(window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
		return isMobile ? `geo:${lat},${lng}?q=${lat},${lng}` : `https://www.google.com/maps?q=${lat},${lng}`;
	}, [hasPosition, displayPosition]);

	const copyAllText = useMemo((): string => {
		const lines: string[] = [];
		if (coordsString) lines.push(`${t('position')}: ${coordsString}`);
		if (addressLine) lines.push(`${t('address')}: ${addressLine}`);
		if (plusCode) lines.push(`${t('plusCode')}: ${plusCode}`);
		if (sectionString) lines.push(`${t('section')}: ${sectionString}`);
		if (roadLabel && roadCompass) {
			lines.push(`${t('nearestRoad')}: ${roadLabel} (${t(`compass.${roadCompass}`)})`);
		}
		if (nearestHgss) {
			const stationLine = `${t('nearestRescue')}: ${nearestHgss.entry.name} (${formatDistanceM(nearestHgss.distanceM, units)})`;
			lines.push(hgssCompass ? `${stationLine} (${t(`compass.${hgssCompass}`)})` : stationLine);
			if (nearestHgss.entry.phone) {
				lines.push(formatPhoneDisplay(nearestHgss.entry.phone));
			}
		}
		return lines.join('\n');
	}, [coordsString, addressLine, plusCode, sectionString, roadLabel, roadCompass, nearestHgss, hgssCompass, units, t]);

	const handleCopyAll = (): void => {
		if (!copyAllText) return;
		void copyTextToClipboard(copyAllText).then((ok) => {
			if (ok) handleCopied('all');
		});
	};

	return (
		<div
			aria-labelledby="emergency-panel-title"
			aria-modal="true"
			className="z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
			role="dialog"
			onClick={onClose}
		>
			<div
				className="border-l-cldt-red max-h-[85vh] w-full max-w-sm overflow-y-auto rounded border-l-2 bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]"
				ref={cardRef}
				onClick={(e) => e.stopPropagation()}
			>
				<h3
					className="text-cldt-red mb-2 text-base font-semibold dark:text-[var(--text-primary)]"
					id="emergency-panel-title"
				>
					{t('title')}
				</h3>

				{gpsUnavailable && (
					<div className="mb-3 flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
						<IoWarningOutline aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
						<span>{displayPosition.source === 'closest' ? t('gpsUnavailable') : t('gpsNoPosition')}</span>
					</div>
				)}

				<div className="flex flex-col gap-3 text-sm text-gray-700 dark:text-[var(--text-primary)]">
					<section className="flex flex-col gap-1.5">
						<h4 className={MAP_CONTROL_SECTION_HEADING}>{t('position')}</h4>
						{hasPosition ? (
							<>
								<div className="flex items-center justify-between gap-2">
									<span className="min-w-0 font-mono text-sm">{coordsString}</span>
									<CopyButton
										ariaLabel={t('copyAriaLabel.coords')}
										copiedField={copiedField}
										field="coords"
										value={coordsString}
										onCopied={handleCopied}
									/>
								</div>
								{addressLoading ? (
									<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">
										{t('addressLoading')}
									</p>
								) : null}
								{addressLine ? (
									<div className="flex items-start justify-between gap-2">
										<span className="min-w-0 text-sm">
											<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('address')}: </span>
											{addressLine}
										</span>
										<CopyButton
											ariaLabel={t('copyAriaLabel.address')}
											copiedField={copiedField}
											field="address"
											value={addressLine}
											onCopied={handleCopied}
										/>
									</div>
								) : null}
								{plusCode ? (
									<div className="flex items-center justify-between gap-2">
										<span className="min-w-0 text-sm">
											<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('plusCode')}: </span>
											<span className="font-mono text-sm">{plusCode}</span>
										</span>
										<CopyButton
											ariaLabel={t('copyAriaLabel.plusCode')}
											copiedField={copiedField}
											field="plusCode"
											value={plusCode}
											onCopied={handleCopied}
										/>
									</div>
								) : null}
								{sectionString ? (
									<div className="flex items-center justify-between gap-2">
										<span className="min-w-0 text-sm">
											<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('section')}: </span>
											{sectionString}
										</span>
										<CopyButton
											ariaLabel={t('copyAriaLabel.section')}
											copiedField={copiedField}
											field="section"
											value={sectionString}
											onCopied={handleCopied}
										/>
									</div>
								) : null}
							</>
						) : (
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('gpsNoPosition')}</span>
						)}
					</section>

					<section className={cn('flex flex-col gap-1.5', SECTION_DIVIDER)}>
						<h4 className={MAP_CONTROL_SECTION_HEADING}>{t('nearestRoad')}</h4>
						{nearestRoad && roadCompass ? (
							<div className="flex items-center justify-between gap-2">
								<span className="min-w-0 text-sm">{roadLabel}</span>
								<CompassBearing
									bearingDeg={nearestRoad.bearingDeg}
									compass={t(`compass.${roadCompass}`)}
									label={t(`compass.${roadCompass}`)}
								/>
							</div>
						) : (
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">-</span>
						)}
					</section>

					<section className={cn('flex flex-col gap-1.5', SECTION_DIVIDER)}>
						<h4 className={MAP_CONTROL_SECTION_HEADING}>{t('nearestRescue')}</h4>
						{nearestHgss && hgssCompass ? (
							<div className="flex flex-col gap-1.5">
								<div className="flex items-center justify-between gap-2">
									<span className="min-w-0 text-sm">
										{nearestHgss.entry.name}
										<span className="ml-1 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
											· {formatDistanceM(nearestHgss.distanceM, units)}
										</span>
									</span>
									<CompassBearing
										bearingDeg={nearestHgss.bearingDeg}
										compass={t(`compass.${hgssCompass}`)}
										label={t(`compass.${hgssCompass}`)}
									/>
								</div>
								{(nearestHgss.entry.phone || nearestHgss.entry.url) && (
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
										{nearestHgss.entry.phone && (
											<a
												aria-label={t('callStation', { name: nearestHgss.entry.name })}
												className="text-cldt-blue hover:text-cldt-green focus-visible:text-cldt-green focus-visible:ring-cldt-green inline-flex items-center gap-1 outline-none focus-visible:ring-1 focus-visible:ring-offset-1"
												href={`tel:${nearestHgss.entry.phone}`}
											>
												<IoCallOutline aria-hidden className="h-3.5 w-3.5" />
												<span className="font-mono text-sm">{formatPhoneDisplay(nearestHgss.entry.phone)}</span>
											</a>
										)}
										{isSafeUrl(nearestHgss.entry.url) && (
											<a
												aria-label={t('openStationPage', { name: nearestHgss.entry.name })}
												className="text-cldt-blue hover:text-cldt-green focus-visible:text-cldt-green focus-visible:ring-cldt-green inline-flex items-center gap-1 outline-none focus-visible:ring-1 focus-visible:ring-offset-1"
												href={nearestHgss.entry.url}
												rel="noopener noreferrer"
												target="_blank"
											>
												<IoOpenOutline aria-hidden className="h-3.5 w-3.5" />
												<span>{t('stationDetails')}</span>
											</a>
										)}
									</div>
								)}
							</div>
						) : (
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">-</span>
						)}
					</section>
				</div>

				<div className="mt-4 flex flex-col gap-2">
					<a
						aria-label={t('callButton')}
						className={cn(buttonVariants({ variant: 'emergencyPrimary', size: 'default' }), 'h-10 w-full')}
						href="tel:112"
					>
						{t('callButton')}
					</a>
					{mapsHref ? (
						<a
							aria-label={t('mapsButton')}
							className={cn(buttonVariants({ variant: 'mapControlOutline', size: 'default' }), 'h-10 w-full')}
							href={mapsHref}
							rel="noopener noreferrer"
							target="_blank"
						>
							{t('mapsButton')}
						</a>
					) : (
						<Button disabled aria-disabled="true" className="h-10 w-full" size="default" variant="mapControlOutline">
							{t('mapsButton')}
						</Button>
					)}
				</div>

				<div className="mt-3 flex justify-end gap-2">
					{copyAllText ? (
						<Button
							className={cn(copiedField === 'all' && 'text-cldt-green')}
							size="sm"
							variant="mapControlOutlineSecondary"
							onClick={handleCopyAll}
						>
							{copiedField === 'all' ? t('copyTooltipSuccess') : t('copyAllButton')}
						</Button>
					) : null}
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={onClose}>
						{t('close')}
					</Button>
				</div>
			</div>
		</div>
	);
}
