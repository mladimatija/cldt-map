'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { OpenLocationCode } from 'open-location-code';
import { IoCopyOutline, IoWarningOutline } from 'react-icons/io5';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';
import { Button, buttonVariants } from '@/components/ui/Button';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { computeBearing, findNearestPointIndex, formatDistanceM } from '@/lib/distance-utils';
import {
	bearingToCompass,
	findNearestEntry,
	loadEmergencyData,
	type HgssStation,
	type RoadAccessEntry,
} from '@/lib/emergency-data';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const COPY_RESET_MS = 1500;

interface MapControlsEmergencyPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
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

type CopyField = 'coords' | 'plusCode' | 'section';

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
		<button
			aria-label={ariaLabel}
			className={`focus-visible:ring-cldt-green -my-1 inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[var(--bg-secondary)] ${
				isCopied ? 'text-cldt-green' : 'text-gray-500 dark:text-[var(--text-secondary)]'
			} hover:bg-gray-100 focus-visible:bg-gray-100 dark:hover:bg-white/10 dark:focus-visible:bg-white/10`}
			title={isCopied ? t('copyTooltipSuccess') : t('copyTooltipDefault')}
			type="button"
			onClick={handleClick}
		>
			<IoCopyOutline aria-hidden className="h-4 w-4" />
		</button>
	);
}

const olc = new OpenLocationCode();
// Road-type tokens (e.g. 'residential', 'unclassified') get a localised label;
// proper-noun roadRefs like 'D2' or 'Ulica X' pass through as-is.
const LOCALISABLE_ROAD_TYPES = new Set(['unclassified', 'residential', 'road']);

export function MapControlsEmergencyPanel({
	containerRef,
	onClose,
}: MapControlsEmergencyPanelProps): React.ReactElement {
	const t = useTranslations('emergency');

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

	// Lazy-load emergency data on first open
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

	// Focus trap mirroring MapControlsSharePanel
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		first?.focus();

		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
				return;
			}
			if (e.key !== 'Tab') return;
			if (focusables.length === 0) return;
			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last?.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first?.focus();
				}
			}
		};
		el.addEventListener('keydown', handleKeyDown);
		return () => el.removeEventListener('keydown', handleKeyDown);
	}, [containerRef, onClose]);

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

	// Resolve the display position: GPS first, fallback to closestPoint.
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
		const nearest = findNearestEntry(roadAccess, displayPosition.lat, displayPosition.lng, computeBearing);
		return nearest;
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
		const parts = [sectionName, km !== null ? t('kmFromStart', { km: km.toFixed(2) }) : null].filter(
			(p): p is string => p !== null,
		);
		return parts.join(' - ');
	}, [sectionInfo, t]);

	const hasPosition = displayPosition.source !== null;
	const geoHref = hasPosition ? `geo:${displayPosition.lat.toFixed(6)},${displayPosition.lng.toFixed(6)}` : undefined;

	return (
		<div
			aria-labelledby="emergency-panel-title"
			className={`z-controls-popover border-l-cldt-red absolute right-[calc(100%+0.5rem)] bottom-0 flex w-80 flex-col gap-2 border-l-2 ${MAP_CONTROL_POPOVER}`}
			ref={containerRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			<div className="flex items-center justify-between">
				<h3 className="text-cldt-red text-sm font-semibold dark:text-[var(--text-primary)]" id="emergency-panel-title">
					{t('title')}
				</h3>
				<button
					aria-label={t('close')}
					className="cursor-pointer rounded text-gray-500 outline-none hover:bg-black/5 hover:text-gray-800 focus-visible:bg-black/5 focus-visible:text-gray-800 dark:text-[var(--text-secondary)] dark:hover:bg-white/10 dark:hover:text-[var(--text-primary)] dark:focus-visible:bg-white/10 dark:focus-visible:text-[var(--text-primary)]"
					type="button"
					onClick={onClose}
				>
					<span aria-hidden="true" className="text-lg leading-none">
						&times;
					</span>
				</button>
			</div>

			{gpsUnavailable && (
				<div className="-mx-3 -mt-3 mb-0 flex items-start gap-2 bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
					<IoWarningOutline aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
					<span>{displayPosition.source === 'closest' ? t('gpsUnavailable') : t('gpsNoPosition')}</span>
				</div>
			)}

			{/* Position section */}
			<section className="flex flex-col gap-1 text-xs text-gray-700 dark:text-[var(--text-primary)]">
				<h4 className="font-medium text-gray-600 dark:text-[var(--text-secondary)]">{t('position')}</h4>
				{hasPosition ? (
					<>
						<div className="flex items-center justify-between gap-2">
							<span className="font-mono text-base">{coordsString}</span>
							<CopyButton
								ariaLabel={t('copyAriaLabel.coords')}
								copiedField={copiedField}
								field="coords"
								value={coordsString}
								onCopied={handleCopied}
							/>
						</div>
						{plusCode && (
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono text-base">
									<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('plusCode')}: </span>
									{plusCode}
								</span>
								<CopyButton
									ariaLabel={t('copyAriaLabel.plusCode')}
									copiedField={copiedField}
									field="plusCode"
									value={plusCode}
									onCopied={handleCopied}
								/>
							</div>
						)}
						{sectionString && (
							<div className="flex items-center justify-between gap-2">
								<span>
									<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('section')}: </span>
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
						)}
					</>
				) : (
					<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('gpsNoPosition')}</span>
				)}
			</section>

			{/* Nearest road */}
			<section className="flex flex-col gap-1 text-xs text-gray-700 dark:text-[var(--text-primary)]">
				<h4 className="font-medium text-gray-600 dark:text-[var(--text-secondary)]">{t('nearestRoad')}</h4>
				{nearestRoad && roadCompass ? (
					<div className="flex items-center justify-between gap-2">
						<span>{roadLabel}</span>
						<span
							aria-label={t(`compass.${roadCompass}`)}
							className="inline-flex items-center gap-1 text-xs"
							role="img"
							title={t(`compass.${roadCompass}`)}
						>
							<span
								aria-hidden="true"
								className="text-cldt-blue inline-block"
								style={{ transform: `rotate(${nearestRoad.bearingDeg}deg)` }}
							>
								&#8593;
							</span>
							<span aria-hidden="true" className="font-medium">
								{roadCompass}
							</span>
						</span>
					</div>
				) : (
					<span className="text-gray-500 dark:text-[var(--text-secondary)]">-</span>
				)}
			</section>

			{/* Nearest HGSS */}
			<section className="flex flex-col gap-1 text-xs text-gray-700 dark:text-[var(--text-primary)]">
				<h4 className="font-medium text-gray-600 dark:text-[var(--text-secondary)]">{t('nearestRescue')}</h4>
				{nearestHgss && hgssCompass ? (
					<div className="flex items-center justify-between gap-2">
						<span>
							{nearestHgss.entry.name}
							<span className="ml-1 text-gray-500 dark:text-[var(--text-secondary)]">
								· {formatDistanceM(nearestHgss.distanceM, units)}
							</span>
						</span>
						<span
							aria-label={t(`compass.${hgssCompass}`)}
							className="inline-flex items-center gap-1 text-xs"
							role="img"
							title={t(`compass.${hgssCompass}`)}
						>
							<span
								aria-hidden="true"
								className="text-cldt-blue inline-block"
								style={{ transform: `rotate(${nearestHgss.bearingDeg}deg)` }}
							>
								&#8593;
							</span>
							<span aria-hidden="true" className="font-medium">
								{hgssCompass}
							</span>
						</span>
					</div>
				) : (
					<span className="text-gray-500 dark:text-[var(--text-secondary)]">-</span>
				)}
			</section>

			{/* Action buttons */}
			<div className="mt-1 flex flex-col gap-2">
				<a
					aria-label={t('callButton')}
					className={`${buttonVariants({ variant: 'emergencyPrimary', size: 'default' })} h-10`}
					href="tel:112"
				>
					{t('callButton')}
				</a>
				{geoHref ? (
					<a
						aria-label={t('mapsButton')}
						className={`${buttonVariants({ variant: 'mapControlOutline', size: 'default' })} h-10`}
						href={geoHref}
					>
						{t('mapsButton')}
					</a>
				) : (
					<Button disabled aria-disabled="true" variant="mapControlOutline">
						{t('mapsButton')}
					</Button>
				)}
			</div>
		</div>
	);
}
